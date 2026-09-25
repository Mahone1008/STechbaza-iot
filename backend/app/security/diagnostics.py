from typing import Annotated

from fastapi import Depends, HTTPException

from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import PlatformRole


def require_diagnostics_access(
    current: Annotated[CurrentUserContext, Depends(get_current_user_context)],
) -> None:
    """Глобальна діагностика містить дані різних tenant — лише для superadmin."""

    if current.user.platform_role != PlatformRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Недостатньо прав для діагностики")
