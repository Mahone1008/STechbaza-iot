"""Canonical inbound device topic grammar."""


def extract_device_uid(topic: str, expected_suffix: str) -> str | None:
    parts = topic.split("/")
    if (
        len(parts) == 4
        and parts[0] == "techbaza"
        and parts[1] == "devices"
        and parts[2]
        and parts[3] == expected_suffix
    ):
        return parts[2]
    return None


def extract_command_event_uid(topic: str, event_name: str) -> str | None:
    parts = topic.split("/")
    if (
        len(parts) == 5
        and parts[0] == "techbaza"
        and parts[1] == "devices"
        and parts[2]
        and parts[3] == "commands"
        and parts[4] == event_name
    ):
        return parts[2]
    return None
