import io, os, tempfile, unittest

tmp = tempfile.mkdtemp()
os.environ.update(DATABASE_PATH=os.path.join(tmp, "t.db"), ADMIN_PASSWORD="pw-test", SECRET_KEY="x")
import app as vlab  # noqa: E402


class Api(unittest.TestCase):
    def setUp(self):
        with vlab.app.app_context():
            vlab.seed(reset=True)  # every test starts from the original 116 rows
        self.c = vlab.app.test_client()

    def login(self):
        self.assertEqual(self.c.post("/api/login", json={"password": "pw-test"}).status_code, 200)

    def test_seed_and_public_read(self):
        rows = self.c.get("/api/records").get_json()
        self.assertEqual(len(rows), 116)
        self.assertEqual(sum(r["users"] for r in rows if not r["dup"]), 2994)
        self.assertEqual(self.c.get("/").status_code, 200)

    def test_admin_required(self):
        body = {"date": "2024-05-06", "dept": "Computer Engineering", "users": 3, "usage": 4}
        self.assertEqual(self.c.post("/api/records", json=body).status_code, 401)
        self.assertEqual(self.c.delete("/api/records/1").status_code, 401)
        self.assertEqual(self.c.post("/api/login", json={"password": "nope"}).status_code, 401)

    def test_crud_and_validation(self):
        self.login()
        body = {"date": "2024-05-06", "dept": "Computer Engineering", "users": 3, "usage": 4}
        rid = self.c.post("/api/records", json=body).get_json()["id"]
        self.assertEqual(self.c.put(f"/api/records/{rid}", json={**body, "users": 9}).status_code, 200)
        row = next(r for r in self.c.get("/api/records").get_json() if r["id"] == rid)
        self.assertEqual(row["users"], 9)
        self.assertEqual(self.c.post("/api/records", json={**body, "date": "06/05/2024"}).status_code, 400)
        self.assertEqual(self.c.post("/api/records", json={**body, "users": -1}).status_code, 400)
        self.assertEqual(self.c.delete(f"/api/records/{rid}").status_code, 200)
        self.assertEqual(self.c.delete(f"/api/records/{rid}").status_code, 404)

    def test_import_skips_existing_and_export(self):
        self.login()
        exp = self.c.get("/api/export.csv").data
        r = self.c.post("/api/import", data={"file": (io.BytesIO(exp), "x.csv")}, content_type="multipart/form-data")
        self.assertEqual(r.get_json()["added"], 0)
        new = b"date,department,student_count,usage_count,duplicate_report,source_pdf\n2024-11-05,Information Technology,12,15,N,Nov/5.pdf\n"
        r = self.c.post("/api/import", data={"file": (io.BytesIO(new), "n.csv")}, content_type="multipart/form-data")
        self.assertEqual(r.get_json()["added"], 1)


if __name__ == "__main__":
    unittest.main()
