"""Чистая смена стиля перерисовывает картинку, а не весь конспект."""

from __future__ import annotations

from unittest.mock import patch

from django.test import SimpleTestCase

from ai_engine.skills.board import BoardSkill

REFERENCE = "data:image/png;base64,AAAA"
PROMPT = "block on an inclined plane with force arrows"


def run_restyle(message: str, **overrides):
    kwargs = {
        "style": "flat",
        "reference_image_url": REFERENCE,
        "reference_prompt": PROMPT,
        "reference_labels": [{"content": "mg", "x": 10, "y": 20}],
    }
    kwargs.update(overrides)
    return BoardSkill().run(user_message=message, history=[{"role": "user", "content": "нарисуй"}], **kwargs)


class DeterministicRestyleTests(SimpleTestCase):
    def test_style_command_does_not_call_the_model(self) -> None:
        # Главное: раньше сюда уходил запрос к board-модели, она возвращала
        # доску целиком, и на холст ложилась вторая копия всего текста.
        with patch("ai_engine.skills.board.openrouter_client") as client:
            result = run_restyle("сделай в стиле скетч")

        client.chat.completions.create.assert_not_called()
        self.assertTrue(result.board["restyle"])

    def test_board_contains_only_the_illustration(self) -> None:
        with patch("ai_engine.skills.board.openrouter_client"):
            result = run_restyle("сделай в стиле скетч")

        commands = [
            command
            for step in result.board["board_steps"]
            for command in step["commands"]
        ]
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0]["type"], "image_with_labels")

    def test_subject_and_labels_are_reused(self) -> None:
        with patch("ai_engine.skills.board.openrouter_client"):
            result = run_restyle("сделай в стиле скетч")

        command = result.board["board_steps"][0]["commands"][0]
        self.assertEqual(command["image_prompt"], PROMPT)
        self.assertEqual(command["labels"], [{"content": "mg", "x": 10, "y": 20}])
        self.assertEqual(command["gen_style"], "sketch")

    def test_without_a_previous_picture_it_is_a_normal_request(self) -> None:
        # Нечего перерисовывать — обычный путь через модель, иначе первая же
        # просьба «нарисуй в стиле скетч» вернула бы пустую доску.
        with patch("ai_engine.skills.board.openrouter_client") as client:
            client.chat.completions.create.side_effect = RuntimeError("модель вызвана")
            with self.assertRaises(RuntimeError):
                run_restyle("сделай в стиле скетч", reference_image_url=None)

    def test_without_a_stored_prompt_it_falls_back_to_the_model(self) -> None:
        # Картинки, нарисованные до появления imagePrompt, сюжета не хранят —
        # для них остаётся прежний путь, а не пустой рестайл.
        with patch("ai_engine.skills.board.openrouter_client") as client:
            client.chat.completions.create.side_effect = RuntimeError("модель вызвана")
            with self.assertRaises(RuntimeError):
                run_restyle("сделай в стиле скетч", reference_prompt="")

    def test_content_request_is_not_treated_as_restyle(self) -> None:
        # «Нарисуй плоское зеркало» — про предмет, а не про стиль: такой запрос
        # обязан идти в модель, иначе вместо новой схемы будет перекраска старой.
        with patch("ai_engine.skills.board.openrouter_client") as client:
            client.chat.completions.create.side_effect = RuntimeError("модель вызвана")
            with self.assertRaises(RuntimeError):
                run_restyle("нарисуй плоское зеркало и ход лучей")
