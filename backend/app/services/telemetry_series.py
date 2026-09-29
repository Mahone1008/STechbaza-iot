import math
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.repositories.capabilities import CapabilityRepository
from app.repositories.telemetry_series import TelemetrySeriesRepository
from app.schemas.telemetry_read import TelemetryBucketRead, TelemetrySeriesQuery, TelemetrySeriesRead
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission, role_has_permission
from app.services.telemetry_policy import VALUE_CAPABILITY_REQUIREMENTS
from app.services.telemetry_read_config import METRIC_UNITS, SERIES_MAX_MESSAGES
from app.device_contract import selected_channels


class SeriesMetricError(Exception):
    pass


class SeriesCapabilityError(Exception):
    pass


class SeriesTooLargeError(Exception):
    pass


class SeriesPermissionError(Exception):
    pass


class TelemetrySeriesService:
    def __init__(self, session: Session, current: CurrentUserContext):
        self._session = session
        self._access = AccessControl(session, current)

    def read(self, device_id: uuid.UUID, query: TelemetrySeriesQuery) -> TelemetrySeriesRead:
        context = self._access.require_device_context(device_id, Permission.TELEMETRY_READ)
        if not self._access.is_superadmin and not all(
            role_has_permission(context.organization_role, permission)
            for permission in (Permission.CAPABILITY_READ, Permission.DEVICE_READ)
        ):
            raise SeriesPermissionError
        capability = VALUE_CAPABILITY_REQUIREMENTS.get(query.metric)
        if capability is None or query.metric not in METRIC_UNITS:
            raise SeriesMetricError
        assignments = CapabilityRepository(self._session).get_enabled_assignments_for_device(device_id)
        available = {channel.key for item in assignments for channel in selected_channels(item.capability.code, item.config)
                     if channel.supports_series}
        if query.metric not in available:
            raise SeriesCapabilityError
        rows = TelemetrySeriesRepository(self._session).aggregate(device_id, query)
        message_count = sum(row["message_count"] for row in rows)
        if message_count > SERIES_MAX_MESSAGES:
            # Не повертати графік обрізаного фрагмента як повний період.
            raise SeriesTooLargeError
        grouped = {row["bucket"]: row for row in rows}
        buckets = []
        for index in range(math.ceil((query.end - query.start).total_seconds() / query.bucket_seconds)):
            start = query.start + timedelta(seconds=index * query.bucket_seconds)
            row = grouped.get(index)
            valid = row["sample_count"] if row else 0
            missing = row["missing_count"] if row else 0
            invalid = row["message_count"] - valid - missing if row else 0
            if row is None:
                status = "empty"
            elif valid:
                status = "partial" if missing or invalid else "ok"
            else:
                status = "invalid" if invalid else "missing"
            buckets.append(TelemetryBucketRead(
                start=start, end=start + min(query.end - start, timedelta(seconds=query.bucket_seconds)),
                status=status, sample_count=valid, missing_count=missing, invalid_count=invalid,
                minimum=float(row["minimum"]) if valid else None,
                maximum=float(row["maximum"]) if valid else None,
                average=float(row["average"]) if valid else None,
            ))
        return TelemetrySeriesRead(
            device_id=device_id, metric=query.metric, unit=METRIC_UNITS[query.metric],
            start=query.start, end=query.end, bucket_seconds=query.bucket_seconds,
            generated_at=datetime.now(timezone.utc), message_count=message_count,
            sample_count=sum(bucket.sample_count for bucket in buckets),
            max_messages=SERIES_MAX_MESSAGES, buckets=buckets,
        )
