"""Build a compact copy of the site into dist/ (no Node needed).

It only strips comments, indentation and blank lines; the output is the same code.
Usage:  python build.py
"""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
SKIP_DIRS = {"dist", "dev", ".vercel", "__pycache__"}
SKIP_FILES = {"build.py", "dev_server.py", "README.md", ".gitignore"}


def min_css(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([{};,>])\s*", r"\1", text)
    text = re.sub(r":\s+", ":", text)
    # restore spaces needed inside selectors like ":root:not(...)" is not affected;
    # but "a :hover" style descendant pseudo selectors are not used in this project.
    return text.replace(";}", "}").strip() + "\n"


def min_js(text: str) -> str:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("//"):
            continue
        out.append(s)
    return "\n".join(out) + "\n"


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    total_in = total_out = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if name in SKIP_FILES:
                continue
            src = os.path.join(dirpath, name)
            rel = os.path.relpath(src, ROOT)
            dst = os.path.join(DIST, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(src, encoding="utf-8") as f:
                text = f.read()
            if name.endswith(".css"):
                out = min_css(text)
            elif name.endswith(".js"):
                out = min_js(text)
            else:
                out = text
            with open(dst, "w", encoding="utf-8", newline="\n") as f:
                f.write(out)
            total_in += len(text.encode())
            total_out += len(out.encode())
            print(f"{rel:40} {len(text.encode()):>7} -> {len(out.encode()):>7}")
    print(f"total {total_in} -> {total_out} bytes")


if __name__ == "__main__":
    main()
