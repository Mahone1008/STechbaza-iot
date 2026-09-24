import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://techbaza:techbaza_dev_only@postgres:5432/techbaza",
)

engine: Engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)


def check_database() -> dict[str, str]:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                """
                SELECT
                    current_database() AS database_name,
                    current_user AS database_user,
                    version() AS database_version
                """
            )
        ).mappings().one()

    return {
        "database": row["database_name"],
        "user": row["database_user"],
        "version": row["database_version"],
    }
