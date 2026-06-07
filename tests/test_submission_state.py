from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.submission_state import (
    ALLOWED_SUBMISSION_STATES,
    InvalidPaymentRequestStateError,
    extract_payment_request_state,
    validate_payment_request_state,
)


class ValidatePaymentRequestStateTest(unittest.TestCase):
    def test_allowed_states_are_accepted(self) -> None:
        for state in ALLOWED_SUBMISSION_STATES:
            self.assertEqual(validate_payment_request_state(state), state)

    def test_lowercase_states_are_normalized(self) -> None:
        self.assertEqual(validate_payment_request_state("brouillon"), "BROUILLON")

    def test_rejetee_state_raises_with_rejected_reason(self) -> None:
        with self.assertRaises(InvalidPaymentRequestStateError) as context:
            validate_payment_request_state("REJETEE")

        error = context.exception
        self.assertEqual(error.current_state, "REJETEE")
        self.assertEqual(error.reason, "rejected")
        payload = error.to_error_payload()
        self.assertEqual(payload["error_code"], "INVALID_PAYMENT_REQUEST_STATE")
        self.assertEqual(payload["current_state"], "REJETEE")
        self.assertEqual(
            sorted(payload["allowed_states"]),
            sorted(ALLOWED_SUBMISSION_STATES),
        )
        self.assertIn("REJETEE", payload["message"])

    def test_a_recycler_requires_dedicated_recycle_action(self) -> None:
        with self.assertRaises(InvalidPaymentRequestStateError) as context:
            validate_payment_request_state("A_RECYCLER")

        error = context.exception
        self.assertEqual(error.current_state, "A_RECYCLER")
        self.assertEqual(error.reason, "recyclable")
        self.assertIn("recyclage", str(error).lower())

    def test_empty_state_raises_with_missing_reason(self) -> None:
        with self.assertRaises(InvalidPaymentRequestStateError) as context:
            validate_payment_request_state("")
        self.assertEqual(context.exception.reason, "missing")

    def test_none_state_raises_with_missing_reason(self) -> None:
        with self.assertRaises(InvalidPaymentRequestStateError) as context:
            validate_payment_request_state(None)
        self.assertEqual(context.exception.reason, "missing")

    def test_unknown_state_raises_with_unknown_reason(self) -> None:
        with self.assertRaises(InvalidPaymentRequestStateError) as context:
            validate_payment_request_state("FOOBAR")
        self.assertEqual(context.exception.reason, "unknown")
        self.assertEqual(context.exception.current_state, "FOOBAR")


class ExtractPaymentRequestStateTest(unittest.TestCase):
    def test_returns_false_when_no_state_key_is_present(self) -> None:
        present, value = extract_payment_request_state({"payload": {}})
        self.assertFalse(present)
        self.assertIsNone(value)

    def test_returns_normalized_value_from_current_state_key(self) -> None:
        present, value = extract_payment_request_state({"currentState": "rejetee"})
        self.assertTrue(present)
        self.assertEqual(value, "REJETEE")

    def test_picks_first_matching_key(self) -> None:
        present, value = extract_payment_request_state(
            {"statutCourant": "BROUILLON", "currentState": "REJETEE"}
        )
        self.assertTrue(present)
        # `currentState` est prioritaire car en tête de la liste de clés.
        self.assertEqual(value, "REJETEE")

    def test_returns_present_true_with_none_value_when_key_is_empty(self) -> None:
        present, value = extract_payment_request_state({"currentState": "   "})
        self.assertTrue(present)
        self.assertIsNone(value)

    def test_non_dict_body_is_treated_as_missing(self) -> None:
        present, value = extract_payment_request_state(None)
        self.assertFalse(present)
        self.assertIsNone(value)


if __name__ == "__main__":
    unittest.main()
