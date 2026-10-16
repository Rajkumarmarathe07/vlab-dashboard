"""Virtual Labs student-count dashboard: Flask + SQLite backend.

Public:  GET /  (dashboard), GET /api/records, GET /api/export.csv
Admin:   POST /api/login, POST /api/logout, POST/PUT/DELETE /api/records, POST /api/import
"""
import csv, hmac, io, os, re, sqlite3, time
from datetime import datetime
from functools import wraps
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request, session

BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE, ".env"))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE, "vlab.db"))
SEED_CSV = os.path.join(BASE, "data", "vlab_student_count_dataset.csv")

if os.environ.get("APP_ENV") == "production":
    missing = [key for key in ("SECRET_KEY", "ADMIN_PASSWORD") if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Missing required production environment variables: " + ", ".join(missing))

app = Flask(__name__, static_folder="static", static_url_path="")
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or os.urandom(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",  # blocks cross-site POSTs (CSRF) from carrying the admin cookie
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",  # set COOKIE_SECURE=1 behind HTTPS
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,
)

SCHEMA = """CREATE TABLE IF NOT EXISTS records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, department TEXT NOT NULL,
  students INTEGER NOT NULL DEFAULT 0, usage INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT '')"""
COLS = "date,department,student_count,usage_count,duplicate_report,source_pdf"


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["Referrer-Policy"] = "same-origin"
    return r


def seed(reset=False):
    d = db()
    d.execute(SCHEMA)
    if reset:
        d.execute("DELETE FROM records")
    if d.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 0 and os.path.exists(SEED_CSV):
        with open(SEED_CSV, newline="", encoding="utf-8-sig") as f:
            insert_rows(d, csv.DictReader(f))
    d.commit()


def insert_rows(d, reader):
    have = {(r[0], r[1], r[2]) for r in d.execute("SELECT date,department,source FROM records")}
    added = skipped = 0
    for row in reader:
        try:
            rec = clean({"date": row["date"], "dept": row["department"], "users": row["student_count"],
                         "usage": row["usage_count"]})
        except (ValueError, KeyError, TypeError):
            skipped += 1
            continue
        src = (row.get("source_pdf") or "")[:300]
        if (rec[0], rec[1], src) in have:
            skipped += 1
            continue
        d.execute("INSERT INTO records(date,department,students,usage,duplicate,source) VALUES(?,?,?,?,?,?)",
                  (*rec, 1 if (row.get("duplicate_report") or "").strip().upper() == "Y" else 0, src))
        have.add((rec[0], rec[1], src))
        added += 1
    return added, skipped


def clean(b):
    """Validate one record from a JSON body -> (date, department, students, usage)."""
    date = str(b.get("date", "")).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("Date must be YYYY-MM-DD.")
    datetime.strptime(date, "%Y-%m-%d")
    dept = str(b.get("dept", "")).strip()
    if not dept or len(dept) > 120:
        raise ValueError("Department is required (max 120 characters).")
    nums = []
    for k in ("users", "usage"):
        n = int(b.get(k, 0) or 0)
        if not 0 <= n <= 1_000_000:
            raise ValueError("Students and usage must be between 0 and 1,000,000.")
        nums.append(n)
    return date, dept, nums[0], nums[1]


def out(r):
    return {"id": str(r["id"]), "date": r["date"], "dept": r["department"], "users": r["students"],
            "usage": r["usage"], "dup": bool(r["duplicate"]), "src": r["source"]}


def admin_only(fn):
    @wraps(fn)
    def w(*a, **k):
        if not session.get("admin"):
            return jsonify(error="Admin login required."), 401
        return fn(*a, **k)
    return w


@app.get("/")
def index():
    return app.send_static_file("build/index.html")


@app.get("/api/records")
def list_records():
    rows = db().execute("SELECT * FROM records ORDER BY date DESC, department").fetchall()
    return jsonify([out(r) for r in rows])


@app.get("/api/me")
def me():
    return jsonify(admin=bool(session.get("admin")))


@app.post("/api/login")
def login():
    expected = os.environ.get("ADMIN_PASSWORD", "")
    if not expected:
        return jsonify(error="Server has no ADMIN_PASSWORD configured."), 503
    given = str((request.get_json(silent=True) or {}).get("password", ""))
    if not hmac.compare_digest(given.encode(), expected.encode()):
        time.sleep(0.7)  # slows password guessing
        return jsonify(error="Wrong password."), 401
    session.clear()
    session["admin"] = True
    return jsonify(admin=True)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(admin=False)


def body_or_400():
    b = request.get_json(silent=True)
    if not isinstance(b, dict):
        raise ValueError("Send a JSON object.")
    return clean(b)


@app.post("/api/records")
@admin_only
def create():
    try:
        rec = body_or_400()
    except (ValueError, TypeError) as e:
        return jsonify(error=str(e)), 400
    d = db()
    cur = d.execute("INSERT INTO records(date,department,students,usage,source) VALUES(?,?,?,?,'manual entry')", rec)
    d.commit()
    return jsonify(id=str(cur.lastrowid)), 201


@app.put("/api/records/<int:rid>")
@admin_only
def update(rid):
    try:
        rec = body_or_400()
    except (ValueError, TypeError) as e:
        return jsonify(error=str(e)), 400
    d = db()
    cur = d.execute("UPDATE records SET date=?,department=?,students=?,usage=? WHERE id=?", (*rec, rid))
    d.commit()
    return (jsonify(ok=True), 200) if cur.rowcount else (jsonify(error="Not found."), 404)


@app.delete("/api/records/<int:rid>")
@admin_only
def delete(rid):
    d = db()
    cur = d.execute("DELETE FROM records WHERE id=?", (rid,))
    d.commit()
    return (jsonify(ok=True), 200) if cur.rowcount else (jsonify(error="Not found."), 404)


@app.post("/api/import")
@admin_only
def import_csv():
    f = request.files.get("file")
    if not f:
        return jsonify(error="Attach a CSV file."), 400
    try:
        text = f.read().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        if not {"date", "department", "student_count"} <= set(reader.fieldnames or []):
            return jsonify(error="CSV needs columns: " + COLS), 400
        d = db()
        added, skipped = insert_rows(d, reader)
        d.commit()
    except UnicodeDecodeError:
        return jsonify(error="File must be UTF-8 CSV."), 400
    return jsonify(added=added, skipped=skipped)


@app.get("/api/export.csv")
def export_csv():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLS.split(","))
    for r in db().execute("SELECT * FROM records ORDER BY date, department"):
        w.writerow([r["date"], r["department"], r["students"], r["usage"], "Y" if r["duplicate"] else "N", r["source"]])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=vlab_student_count.csv"})


@app.cli.command("reset-data")
def reset_data():
    """Delete all records and reload data/vlab_student_count_dataset.csv."""
    seed(reset=True)
    print("Database reset to the original dataset.")


with app.app_context():
    seed()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", port=int(os.environ.get("PORT", 5000)))
