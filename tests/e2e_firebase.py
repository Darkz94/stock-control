"""End-to-end browser test of the app in Firebase mode against the local emulators.

Run (starts Auth + Firestore + Hosting emulators, then this script):
  npx firebase emulators:exec --only auth,firestore,hosting --project demo-stock-control "python3 tests/e2e_firebase.py"

Requires Playwright for Python + Chromium. Uses only made-up users; no real Firebase project.
"""
import json, os, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

PROJECT = "demo-stock-control"
AUTH = "http://127.0.0.1:9099"
FS = "http://127.0.0.1:8085"
APP = "http://127.0.0.1:5000/?emulator=1"
shots = Path(os.environ.get("SMOKE_SCREENSHOTS", Path(__file__).resolve().parent / "screenshots"))
shots.mkdir(parents=True, exist_ok=True)


def post(url, body, headers=None, method="POST"):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def make_user(email, role, name):
    uid = post(f"{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {"email": email, "password": "password123", "returnSecureToken": True})["localId"]
    fields = {
        "role": {"stringValue": role}, "active": {"booleanValue": True}, "displayName": {"stringValue": name},
        "email": {"stringValue": email},
        "updatedAt": {"timestampValue": "2026-11-09T00:00:00Z"}, "updatedBy": {"stringValue": "console"}, "lastAuditId": {"stringValue": "bootstrap"},
    }
    # "Bearer owner" bypasses rules in the emulator — the equivalent of the owner using the Firebase console.
    post(f"{FS}/v1/projects/{PROJECT}/databases/(default)/documents/users/{uid}", {"fields": fields}, {"Authorization": "Bearer owner"}, method="PATCH")
    return uid


def sign_in(page, email):
    page.goto(APP, wait_until="domcontentloaded")
    page.locator("#signin-email").fill(email)
    page.locator("#signin-password").fill("password123")
    page.get_by_role("button", name="Sign in").click()
    expect(page.locator(".sidebar-bottom")).to_contain_text("Online", timeout=20000)


def nav(page, view):
    # On phone widths the sidebar is collapsed behind the ☰ button.
    if page.locator("#menu-toggle").is_visible():
        page.locator("#menu-toggle").click()
    page.locator(f'button[data-view="{view}"]').first.click()


errors = []
make_user("admin@example.test", "admin", "Ada Admin")
make_user("ctrl@example.test", "stock-controller", "Cara Controller")
make_user("mgr@example.test", "site-manager", "Thabo Manager")  # must get no access

with sync_playwright() as p:
    exe = os.environ.get("CHROMIUM_PATH")
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"], **({"executable_path": exe} if exe else {}))
    admin = browser.new_context(viewport={"width": 1366, "height": 900}).new_page()
    admin.on("pageerror", lambda e: errors.append("admin: " + str(e)))
    sign_in(admin, "admin@example.test")

    # First-time setup, then receive stock.
    nav(admin, "settings")
    admin.get_by_role("button", name="Run first-time setup").click()
    expect(admin.get_by_text("First-time setup complete")).to_be_visible(timeout=15000)
    nav(admin, "inventory")
    admin.locator('button[data-action="adjust-stock"][data-id="pine-gel-5l"]').click()
    admin.locator("#stock-quantity").fill("12")
    admin.locator("#stock-reason").fill("Supplier delivery")
    admin.get_by_role("button", name="Save stock movement").click()
    expect(admin.locator(".product").filter(has_text="Pine gel").filter(has_text="5 L bucket").locator(".stock-qty")).to_contain_text("12", timeout=15000)

    # Second device: stock controller pastes a WhatsApp order -> instant review ticket.
    ctrl_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    ctrl = ctrl_ctx.new_page()
    ctrl.on("pageerror", lambda e: errors.append("ctrl: " + str(e)))
    sign_in(ctrl, "ctrl@example.test")
    nav(ctrl, "orders")
    ctrl.locator("#quick-paste-message").click()
    ctrl.evaluate("""() => { const t = document.querySelector('#quick-paste-message'); const dt = new DataTransfer(); dt.setData('text/plain', '2 x Pine Gel 5L\\n4 x Two-Stroke Oil 500ml\\n3 x Black Bags'); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
    expect(ctrl.locator(".modal")).to_contain_text("Ticket saved immediately", timeout=15000)
    ticket_id = ctrl.locator(".modal .actions strong").first.inner_text()
    assert ticket_id.startswith("SC-"), ticket_id
    ctrl.screenshot(path=str(shots / "firebase-controller-review.png"))

    # Admin's screen updates live from the other device.
    nav(admin, "orders")
    expect(admin.locator("table.data-table")).to_contain_text(ticket_id, timeout=15000)

    # Paste the same text again: no duplicate.
    ctrl.locator(".modal-actions").get_by_role("button", name="Close", exact=True).click()
    ctrl.evaluate("""() => { const t = document.querySelector('#quick-paste-message'); const dt = new DataTransfer(); dt.setData('text/plain', '2 x Pine Gel 5L\\n4 x Two-Stroke Oil 500ml\\n3 x Black Bags'); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
    expect(ctrl.get_by_text("recently captured")).to_be_visible(timeout=15000)
    ctrl.locator(".modal-actions").get_by_role("button", name="Close", exact=True).click()
    assert ctrl.locator("table.data-table tbody tr").count() == 1

    # Review, confirm (only pine gel is in stock, so keep just that line), prepare, ready, collect.
    ctrl.get_by_role("button", name="View ›").first.click()
    ctrl.get_by_role("button", name="✓ Review and confirm ticket").click()
    ctrl.locator("#review-manager").fill("Thabo Manager")
    # Lines are shown in catalogue order; keep only Pine gel 5 L (the product in stock).
    while ctrl.locator("#line-host .line-entry").count() > 1:
        rows = ctrl.locator("#line-host .line-entry")
        for i in range(rows.count()):
            if rows.nth(i).locator(".order-product").input_value() != "pine-gel-5l":
                rows.nth(i).locator('button[data-action="remove-line"]').click()
                break
    assert ctrl.locator("#line-host .order-product").input_value() == "pine-gel-5l"
    assert ctrl.locator("#line-host .order-qty").input_value() == "2"
    ctrl.get_by_role("button", name="Save and confirm ticket").click()
    expect(ctrl.locator(".modal")).to_contain_text("New request", timeout=15000)
    ctrl.get_by_role("button", name="Start preparing").click()
    expect(ctrl.locator(".modal")).to_contain_text("Preparing", timeout=15000)
    ctrl.get_by_role("button", name="✓ Ready to collect").click()
    expect(ctrl.get_by_role("button", name="Mark collected & deduct stock")).to_be_enabled(timeout=15000)
    ctrl.get_by_role("button", name="Mark collected & deduct stock").click()
    expect(ctrl.locator(".modal .pill")).to_have_text("Collected", timeout=15000)
    ctrl.screenshot(path=str(shots / "firebase-controller-collected.png"))

    nav(admin, "inventory")
    expect(admin.locator(".product").filter(has_text="Pine gel").filter(has_text="5 L bucket").locator(".stock-qty")).to_contain_text("10", timeout=15000)

    # Only admins and stock controllers use the app: a site-manager account sees "No access" and no data.
    mgr = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
    mgr.on("pageerror", lambda e: errors.append("mgr: " + str(e)))
    mgr.goto(APP, wait_until="domcontentloaded")
    mgr.locator("#signin-email").fill("mgr@example.test")
    mgr.locator("#signin-password").fill("password123")
    mgr.get_by_role("button", name="Sign in").click()
    expect(mgr.get_by_text("No access")).to_be_visible(timeout=20000)
    assert mgr.locator("table.data-table").count() == 0
    assert ticket_id not in mgr.content()
    admin.screenshot(path=str(shots / "firebase-admin.png"), full_page=True)

    browser.close()

assert not errors, f"Page JavaScript errors: {errors}"
print("PASS (firebase e2e): sign-in, first-time setup, live sync across devices, instant paste ticket, duplicate guard, review/confirm, collection deducts once, non-staff account has no access")
