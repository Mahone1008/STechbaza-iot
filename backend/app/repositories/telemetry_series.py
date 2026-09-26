import sys
import uuid
from decimal import Decimal

from sqlalchemy import Integer, Numeric, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session

from app.models.telemetry import TelemetryMessage
from app.schemas.telemetry_read import TelemetrySeriesQuery
from app.services.telemetry_read_config import SERIES_MAX_MESSAGES, SERIES_STATEMENT_TIMEOUT_MS


class TelemetrySeriesRepository:
    def __init__(self, session: Session):
        self._session = session

    def aggregate(self, device_id: uuid.UUID, query: TelemetrySeriesQuery):
        # LOCAL діє лише до завершення транзакції запиту; не витікає до pool.
        self._session.execute(select(func.set_config("statement_timeout", str(SERIES_STATEMENT_TIMEOUT_MS), True)))
        source = (
            select(TelemetryMessage.received_at,
                   TelemetryMessage.values[query.metric].label("metric_value"))
            .where(TelemetryMessage.device_id == device_id,
                   TelemetryMessage.received_at >= query.start,
                   TelemetryMessage.received_at < query.end)
            .order_by(TelemetryMessage.received_at, TelemetryMessage.id)
            .limit(SERIES_MAX_MESSAGES + 1)
            .cte("series_source")
        )
        kind = func.jsonb_typeof(source.c.metric_value)
        # CASE не дозволяє cast для strings/objects/bools. Numeric AVG не
        # переповнюється від суми великих, але скінченних float значень.
        number = case((kind == "number", cast(source.c.metric_value, Numeric)), else_=None)
        bound = Decimal.from_float(sys.float_info.max)
        usable = case((and_(number >= bound.copy_negate(), number <= bound), number), else_=None)
        bucket = cast(func.floor(func.extract("epoch", source.c.received_at - query.start)
                                 / query.bucket_seconds), Integer)
        statement = select(
            bucket.label("bucket"), func.count().label("message_count"),
            func.count(usable).label("sample_count"),
            func.sum(case((or_(kind.is_(None), kind == "null"), 1), else_=0)).label("missing_count"),
            func.min(usable).label("minimum"), func.max(usable).label("maximum"),
            func.avg(usable).label("average"),
        ).group_by(bucket).order_by(bucket)
        return list(self._session.execute(statement).mappings())
