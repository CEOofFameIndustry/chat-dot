"""Local OCR and strict numeric-answer parsing. No network or Gemini API."""
import csv
import io
import re
import subprocess


class NoLayoutError(ValueError):
    pass


def parse_numbers(text, allowed):
    if not isinstance(text, str) or not re.fullmatch(r"\s*\d{1,2}(\s*[,;]\s*\d{1,2})*\s*", text):
        raise ValueError("Gemini має відповісти лише номерами через кому.")
    numbers = [int(n) for n in re.split(r"\s*[,;]\s*", text.strip())]
    if not numbers or len(set(numbers)) != len(numbers) or not set(numbers) <= set(allowed):
        raise ValueError("Номери Gemini не відповідають розпізнаним варіантам. Точки не показано.")
    return numbers


def ocr_tokens(png):
    result = subprocess.run(["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"],
                            input=png, capture_output=True, check=True, timeout=20)
    tokens = []
    # Tesseract emits literal OCR text, not CSV-escaped fields. A recognized
    # double quote must never swallow the remaining TSV rows as one field.
    for row in csv.DictReader(io.StringIO(result.stdout.decode()), delimiter="\t", quoting=csv.QUOTE_NONE):
        value = row.get("text", "").strip()
        if not re.fullmatch(r"[1-9]\d?", value):
            continue
        height, confidence = int(row["height"]), float(row["conf"])
        if 8 <= height <= 65 and confidence >= 35:
            tokens.append({"n": int(value), "x": int(row["left"]), "y": int(row["top"]),
                           "w": int(row["width"]), "h": height})
    return tokens


def map_options(tokens, width, height):
    """Recognize aligned numbered cards in one or two columns, reject ambiguity."""
    layouts = []
    for first in [t for t in tokens if t["n"] == 1]:
        tolerance = max(12, first["h"] * .9)
        for second in [t for t in tokens if t["n"] == 2]:
            same_row = abs(second["y"] - first["y"]) <= tolerance
            two_columns = same_row and second["x"] - first["x"] > width * .2
            one_column = abs(second["x"] - first["x"]) <= tolerance and second["y"] > first["y"] + first["h"] * 1.5
            if not (one_column or two_columns):
                continue
            if not .65 <= second["h"] / first["h"] <= 1.5:
                continue
            chain = [first, second]
            for number in range(3, 51):
                anchor = first if one_column or number % 2 else second
                row_y = chain[-1]["y"] if two_columns and number % 2 == 0 else None
                prev = chain[-1] if one_column else chain[-2]
                candidates = [t for t in tokens if t["n"] == number
                              and abs(t["x"] - anchor["x"]) <= tolerance
                              and .65 <= t["h"] / first["h"] <= 1.5
                              and (abs(t["y"] - row_y) <= tolerance if row_y is not None
                                   else t["y"] > prev["y"] + first["h"] * 1.5)]
                if len(candidates) != 1:
                    break
                chain.append(candidates[0])
            layouts.append(chain)
    if not layouts:
        raise NoLayoutError("Не знайшов пронумеровані варіанти 1, 2, … на столі 1. Покажіть тест повністю.")
    best_length = max(map(len, layouts))
    best = [layout for layout in layouts if len(layout) == best_length]
    unique = {tuple((t["n"], t["x"], t["y"]) for t in layout): layout for layout in best}
    if len(unique) != 1:
        raise ValueError("Нумерація варіантів неоднозначна. Залиште на екрані лише одне питання.")
    selected = next(iter(unique.values()))
    # Mark beside the number badge, keeping the digit readable.
    return {t["n"]: {"x": min(999, (t["x"] + t["w"] + t["h"] * .7) * 1000 / width),
                      "y": (t["y"] + t["h"] / 2) * 1000 / height}
            for t in selected}


def locate_options(png, width, height):
    try:
        return map_options(ocr_tokens(png), width, height)
    except NoLayoutError:
        # Sparse OCR sometimes omits isolated digits at normal desktop scale.
        # Keep coordinates normalized against the enlarged image dimensions.
        from PIL import Image
        with Image.open(io.BytesIO(png)) as image:
            enlarged = image.resize((width * 2, height * 2), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            enlarged.save(buffer, "PNG")
        return map_options(ocr_tokens(buffer.getvalue()), width * 2, height * 2)


def display_answer(text, options):
    """Use dots only for unambiguous known numbers; otherwise preserve plain text."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Gemini повернув порожню відповідь.")
    text = text.strip()
    if len(text) > 12000:
        raise ValueError("Відповідь надто довга. Попросіть Gemini відповісти стисло.")
    try:
        numbers = parse_numbers(text, options)
    except ValueError:
        return {"answers": [], "text": text}
    return {"answers": [options[n] for n in numbers], "text": ""}
