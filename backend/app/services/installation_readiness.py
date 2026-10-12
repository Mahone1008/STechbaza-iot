"""One fail-closed readiness and installer authorization policy for both portals."""
from fastapi import HTTPException
from sqlalchemy import select

from app.models import Capability, DeviceCapability
from app.schemas.equipment import EquipmentReadiness
from app.security.authorization import AccessControl
from app.security.roles import Permission, PlatformRole


def can_install(session, current, device):
    if current is None or current.user.platform_role not in (PlatformRole.SUPERADMIN, PlatformRole.SERVICE_ADMIN):
        return False
    try:
        AccessControl(session, current).require_device(device.id, Permission.CAPABILITY_MANAGE)
        return True
    except HTTPException:
        return False


def require_installer(session, current, device):
    # The generic tenant role is still used by access/transfer/customer controls.
    AccessControl(session, current).require_device(device.id, Permission.CAPABILITY_MANAGE)
    if not can_install(session, current, device):
        raise HTTPException(403, "Підготовку обладнання виконує виробник або монтажник із сервісним доступом")


def commissioned_mode(session, device):
    if device.lifecycle_status != "active":
        return None
    from app.models.onboarding import FactoryController
    factory = session.scalar(select(FactoryController).where(FactoryController.device_id == device.id))
    if factory:
        return factory.control_mode
    assignment = session.scalar(select(DeviceCapability).join(Capability).where(
        DeviceCapability.device_id == device.id, Capability.code == "vfd.control"))
    if assignment is None:
        return None
    if not assignment.is_enabled:
        return "read_only"
    return "extended_test" if (assignment.config or {}).get("test_session") == "extended" else "bench_without_motor"


def readiness(session, device, factory, configuration, snapshot, config_state, *, fresh):
    def result(state, title, help_text=None, blocker=None):
        return EquipmentReadiness(state=state, title=title, next_action=help_text,
            blockers=[blocker] if blocker else [])
    if factory and (factory.status != "claimed" or factory.access_revoked):
        return result("blocked", "Доступ контролера призупинено", "Зверніться до власника або сервісу", "Доступ плати відкликано")
    if device and device.lifecycle_status in ("maintenance", "retired"):
        return result("blocked", "Обладнання обслуговується", "Монтажник завершить перевірку", "Керування призупинено на час обслуговування")
    if configuration is None:
        return result("needs_equipment", "Обладнання готує монтажник", "Виробник або монтажник заповнить паспорт і робочі межі", "Не підготовлено конфігурацію обладнання")
    if factory and factory.last_contact_at is None:
        return result("awaiting_controller", "Очікуємо підключення контролера", "Увімкніть живлення контролера та модема", "Плата ще не підтвердила зв’язок")
    if factory and factory.last_contact_transport != factory.network_transport:
        return result("blocked", "Потрібна перевірка підключення", "Виробник перевірить тип інтернету контролера", "Тип мережі плати не відповідає комплекту")
    if snapshot is None:
        return result("awaiting_controller", "Очікуємо показання обладнання", "Залиште контролер увімкненим; монтажник перевірить підключення частотника", "Не отримано показання обладнання")
    if not fresh:
        return result("offline", "Зв’язок із контролером втрачено", "Перевірте живлення та інтернет установки", "Немає свіжих показань")
    if config_state in ("mismatch", "incompatible"):
        return result("blocked", "Потрібна перевірка обладнання", "Монтажник звірить підключення і налаштування", "Конфігурація плати не відповідає підготовленому обладнанню")
    if config_state != "verified":
        return result("needs_local_confirmation", "Очікуємо перевірку монтажником", "Монтажник підтвердить обладнання біля установки", "Обладнання ще не підтверджене платою")
    mode = commissioned_mode(session, device)
    if mode is None or (factory and factory.control_revision < 1):
        return result("needs_commissioning", "Монтажник завершує підготовку", "Після перевірки установки монтажник дозволить використання", "Введення в роботу ще не підтверджене")
    if factory and mode != "read_only":
        if snapshot.state.get("vfd_link") is not True or snapshot.state.get("vfd_fault_code") != 0:
            return result("blocked", "Потрібна перевірка частотника", "Монтажник перевірить зв’язок і помилки обладнання", "Немає підтвердження справності частотника")
        grant = (snapshot.diagnostics or {}).get("control_grant") or {}
        capability = factory.firmware_control_capability
        if capability == "read_only" or (mode == "extended_test" and capability != "full"):
            return result("blocked", "Потрібна підготовка прошивки", "Виробник завантажить прошивку з керуванням", "Прошивка не підтвердила підтримку керування")
        if (grant.get("revision") != factory.control_revision or grant.get("mode") != mode
                or grant.get("accepted") is not True):
            return result("needs_commissioning", "Очікуємо готовність контролера", "Монтажник перевірить дозвіл керування біля установки", "Плата ще не підтвердила чинний дозвіл керування")
        settings = (snapshot.diagnostics or {}).get("vfd_settings") or {}
        local_ready = (settings.get("ready") is True and settings.get("run_source") == 0
            and settings.get("frequency_source") == 0)
        if snapshot.state.get("control_armed") is not True and not local_ready:
            return result("needs_commissioning", "Потрібен дозвіл керування на установці", "Монтажник перевірить захисти та відновить дозвіл біля контролера", "Пуск заблоковано на контролері")
    return result("ready", "Готово до використання" if mode != "read_only" else "Готово до спостереження")
