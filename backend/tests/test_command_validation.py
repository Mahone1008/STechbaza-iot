"""H-05: довільне HTTP-число не повинно виходити з schema як OverflowError."""

import unittest
import uuid

from pydantic import ValidationError

from app.schemas.command import DeviceCommandCreate


class CommandValidationTests(unittest.TestCase):
    def test_unrepresentable_frequency_is_a_validation_error(self):
        for value in (10**400, -(10**400), float("inf"), float("-inf"), float("nan"), True, "50"):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValidationError):
                DeviceCommandCreate(request_id=uuid.uuid4(), command_type="vfd.frequency.set",
                                    payload={"frequency_hz": value})

    def test_frequency_boundaries_preserve_original_payload(self):
        for value in (0, 100, 37.5):
            result = DeviceCommandCreate(request_id=uuid.uuid4(), command_type="vfd.frequency.set",
                                         payload={"frequency_hz": value})
            self.assertEqual(result.payload, {"frequency_hz": value})
            self.assertIs(type(result.payload["frequency_hz"]), type(value))
