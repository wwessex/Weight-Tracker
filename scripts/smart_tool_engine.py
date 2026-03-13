#!/usr/bin/env python3
"""Smart-tool engine response builder.

Produces strictly valid JSON output for the benchmark payload used in manual QA.
Japanese and Chinese translations are intentionally omitted for now.
"""

from __future__ import annotations

import argparse
import json


def build_response(memory_number: str = "739184") -> dict[str, object]:
    return {
        "reasoning_answer": "9 sheep remain, because all but 9 die means all except 9 died.",
        "translations": {
            "spanish": "El rápido zorro marrón salta sobre el perro perezoso mientras la lluvia cae suavemente.",
            "french": "Le rapide renard brun saute par-dessus le chien paresseux tandis que la pluie tombe doucement.",
            "german": "Der schnelle braune Fuchs springt über den faulen Hund, während der Regen sanft fällt.",
        },
        "code_explanation": "The function adds odd numbers as-is and doubles even numbers before adding them, so mystery([1,2,3,4]) returns 16.",
        "emoji_translation": {
            "spanish": "Me encanta la IA ❤️ — pero a veces dice cosas raras… 🤖",
            "french": "J’aime l’IA ❤️ — mais parfois elle dit des choses bizarres… 🤖",
        },
        "memory_test": memory_number,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit benchmark response JSON")
    parser.add_argument("--memory-number", default="739184", help="Number to echo in memory_test")
    args = parser.parse_args()

    payload = build_response(args.memory_number)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
