"""Tests of close_parent.py. Run with `python3 -m unittest discover -s .github/scripts`."""

import unittest

from close_parent import comment, decide


def sub(number, state="CLOSED", reason="COMPLETED"):
    return {"number": number, "state": state, "stateReason": reason if state == "CLOSED" else None}


class DecideTest(unittest.TestCase):
    def test_should_close_as_completed_when_every_card_is_closed_and_one_was_done(self):
        subs = [sub(35), sub(36, reason="NOT_PLANNED")]

        reason = decide("OPEN", 2, subs)

        self.assertEqual(reason, "completed")

    def test_should_close_as_not_planned_when_no_card_was_done(self):
        subs = [sub(35, reason="NOT_PLANNED"), sub(36, reason="DUPLICATE")]

        reason = decide("OPEN", 2, subs)

        self.assertEqual(reason, "not planned")

    def test_should_leave_it_open_when_a_card_is_still_open(self):
        subs = [sub(35), sub(36, state="OPEN")]

        reason = decide("OPEN", 2, subs)

        self.assertIsNone(reason)

    def test_should_do_nothing_when_the_parent_is_already_closed(self):
        subs = [sub(35)]

        reason = decide("CLOSED", 1, subs)

        self.assertIsNone(reason)

    def test_should_do_nothing_when_the_parent_has_no_card(self):
        reason = decide("OPEN", 0, [])

        self.assertIsNone(reason)

    def test_should_do_nothing_when_some_cards_were_not_listed(self):
        subs = [sub(n) for n in range(100)]

        reason = decide("OPEN", 101, subs)

        self.assertIsNone(reason)


class CommentTest(unittest.TestCase):
    def test_should_list_the_cards_when_the_parent_is_done(self):
        text = comment("completed", [sub(35), sub(36)])

        self.assertIn("#35, #36", text)
        self.assertIn("done", text)

    def test_should_say_not_planned_when_no_card_was_done(self):
        text = comment("not planned", [sub(35, reason="NOT_PLANNED")])

        self.assertIn("not planned", text)


if __name__ == "__main__":
    unittest.main()
