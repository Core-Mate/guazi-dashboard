import json
import logging
from typing import Any, Optional

try:
    import requests
except ModuleNotFoundError:
    from pip._vendor import requests


BASE_URL = "http://localhost:8403/api"
HEADERS = {"X-API-Key": "dev-key-guazi-2026"}
ADMIN_ID = 19980233
ADMIN_PHONE = "17749796137"
TENANT_ID = 1
TENANT_CODE = "73S4SK"
TIMEOUT = 10

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class SkipStep(Exception):
    pass


class StepRunner:
    def __init__(self) -> None:
        self.pass_count = 0
        self.fail_count = 0
        self.skip_count = 0
        self.total_count = 0

    def pass_step(self, step_no: str, title: str, detail: str) -> None:
        self.pass_count += 1
        self.total_count += 1
        logger.info("PASS %s %s: %s", step_no, title, detail)

    def fail_step(self, step_no: str, title: str, detail: str) -> None:
        self.fail_count += 1
        self.total_count += 1
        logger.error("FAIL %s %s: %s", step_no, title, detail)

    def skip_step(self, step_no: str, title: str, detail: str) -> None:
        self.skip_count += 1
        self.total_count += 1
        logger.info("SKIP %s %s: %s", step_no, title, detail)

    def run(self, step_no: str, title: str, fn) -> None:
        try:
            detail = fn()
            if detail is None:
                detail = "ok"
            self.pass_step(step_no, title, str(detail))
        except SkipStep as exc:
            self.skip_step(step_no, title, str(exc))
        except AssertionError as exc:
            self.fail_step(step_no, title, str(exc))
        except requests.RequestException as exc:
            self.fail_step(step_no, title, f"request error: {exc}")
        except Exception as exc:
            self.fail_step(step_no, title, f"{type(exc).__name__}: {exc}")


def to_pretty(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except Exception:
        return repr(value)


def request_json(
    session: requests.Session,
    method: str,
    path: str,
    *,
    expected_status: Optional[int] = None,
    **kwargs: Any,
) -> tuple[requests.Response, Any]:
    response = session.request(method, f"{BASE_URL}{path}", timeout=TIMEOUT, **kwargs)
    body: Any
    try:
        body = response.json()
    except ValueError:
        body = response.text
    if expected_status is not None and response.status_code != expected_status:
        raise AssertionError(
            f"expected {expected_status}, got {response.status_code}, response={to_pretty(body)}"
        )
    return response, body


def get_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        items = payload.get("items")
        if isinstance(items, list):
            return items
        data = payload.get("data")
        if isinstance(data, list):
            return data
    raise AssertionError(f"unexpected payload shape: {to_pretty(payload)}")


def get_total(payload: Any) -> Optional[int]:
    if isinstance(payload, dict):
        total = payload.get("total")
        if isinstance(total, (int, float)):
            return int(total)
        count = payload.get("count")
        if isinstance(count, (int, float)):
            return int(count)
        items = payload.get("items")
        if isinstance(items, list):
            return len(items)
    if isinstance(payload, list):
        return len(payload)
    return None


def normalize_member(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": item.get("name") or item.get("username"),
        "phone": item.get("phone") or item.get("phone_number") or item.get("phoneNumber"),
        "role": item.get("role"),
        "balance": item.get("balance"),
        "raw": item,
    }


def balance_to_float(value: Any) -> float:
    if value is None:
        raise AssertionError("balance is missing")
    return float(value)


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual: float, expected: float, label: str, epsilon: float = 1e-6) -> None:
    if abs(actual - expected) > epsilon:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")


def fetch_all_members(session: requests.Session) -> list[dict[str, Any]]:
    response, payload = request_json(session, "GET", "/members", expected_status=200)
    _ = response
    if isinstance(payload, list):
        return [normalize_member(item) for item in payload]

    if not isinstance(payload, dict):
        raise AssertionError(f"unexpected members payload: {to_pretty(payload)}")

    items = [normalize_member(item) for item in get_items(payload)]
    total = get_total(payload)
    if total is None or total <= len(items):
        return items

    page = 2
    page_size = max(len(items), 20)
    while len(items) < total:
        _, next_payload = request_json(
            session,
            "GET",
            f"/members?page={page}&page_size={page_size}",
            expected_status=200,
        )
        next_items = [normalize_member(item) for item in get_items(next_payload)]
        if not next_items:
            break
        items.extend(next_items)
        page += 1
    return items


def find_member(
    members: list[dict[str, Any]],
    *,
    user_id: Optional[int] = None,
    phone: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    for member in members:
        if user_id is not None and member["id"] == user_id:
            return member
        if phone is not None and member["phone"] == phone:
            return member
    return None


def fetch_wallet(session: requests.Session) -> dict[str, Any]:
    _, payload = request_json(session, "GET", "/wallet", expected_status=200)
    if not isinstance(payload, dict):
        raise AssertionError(f"unexpected wallet payload: {to_pretty(payload)}")
    return payload


def fetch_audit_log(session: requests.Session, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    _, payload = request_json(
        session,
        "GET",
        f"/audit-log?page={page}&page_size={page_size}",
        expected_status=200,
    )
    if not isinstance(payload, dict):
        raise AssertionError(f"unexpected audit-log payload: {to_pretty(payload)}")
    return payload


def fetch_transactions(session: requests.Session, page: int = 1, page_size: int = 5) -> dict[str, Any]:
    _, payload = request_json(
        session,
        "GET",
        f"/transactions?page={page}&page_size={page_size}",
        expected_status=200,
    )
    if not isinstance(payload, dict):
        raise AssertionError(f"unexpected transactions payload: {to_pretty(payload)}")
    return payload


def main() -> None:
    logger.info("=== Dashboard Backend Write API E2E ===")
    logger.info("BASE_URL=%s", BASE_URL)
    logger.info("HEADERS api_key_present=%s", bool(HEADERS.get("X-API-Key")))
    logger.info(
        "ADMIN_ID=%s ADMIN_PHONE=%s TENANT_ID=%s TENANT_CODE=%s",
        ADMIN_ID,
        ADMIN_PHONE,
        TENANT_ID,
        TENANT_CODE,
    )

    runner = StepRunner()
    session = requests.Session()
    session.headers.update(HEADERS)

    state: dict[str, Any] = {
        "initial_admin_balance": None,
        "initial_audit_total": None,
        "new_id": None,
        "wallet_total_before_first_distribute": None,
        "admin_balance_after_step6": None,
        "member_balance_after_step6": None,
        "audit_total_after_step11": None,
    }

    def require_state(key: str, description: str) -> Any:
        value = state.get(key)
        if value is None:
            raise SkipStep(f"missing prerequisite: {description}")
        return value

    runner.run("0.", "GET /members setup", lambda: step_0(session, state))
    runner.run("0b.", "GET /audit-log setup", lambda: step_0b(session, state))
    runner.run("1.", "POST /members add member", lambda: step_1(session, state))
    runner.run("2.", "GET /members verify added member", lambda: step_2(session, state, require_state))
    runner.run("3.", "PUT /members/{new_id} edit member", lambda: step_3(session, state, require_state))
    runner.run("4.", "GET /members verify edited member", lambda: step_4(session, state, require_state))
    runner.run("5.", "POST /credits/distribute admin -> member", lambda: step_5(session, state, require_state))
    runner.run("6.", "GET /members verify balances after distribute", lambda: step_6(session, state, require_state))
    runner.run("7.", "GET /wallet verify zero-sum transfer", lambda: step_7(session, state, require_state))
    runner.run("8.", "GET /transactions verify DISTRIBUTE records", lambda: step_8(session, state))
    runner.run("9.", "POST /credits/distribute member -> admin", lambda: step_9(session, state, require_state))
    runner.run("10.", "GET /members verify balances after reverse distribute", lambda: step_10(session, state, require_state))
    runner.run("11.", "GET /audit-log verify write audit entries", lambda: step_11(session, state, require_state))
    runner.run("12.", "POST /members invalid initial_balance", lambda: step_12(session))
    runner.run("13.", "POST /credits/distribute amount=0", lambda: step_13(session))
    runner.run("14.", "POST /credits/distribute insufficient balance", lambda: step_14(session, state))
    runner.run("15.", "POST /credits/distribute operator not found", lambda: step_15(session))
    runner.run("16.", "DELETE /members/{new_id}", lambda: step_16(session, state, require_state))
    runner.run("17.", "GET /members verify deletion", lambda: step_17(session, state, require_state))
    runner.run("18.", "GET /audit-log verify REMOVE_MEMBER entry", lambda: step_18(session, state, require_state))

    logger.info(
        "SUMMARY "
        f"PASS={runner.pass_count} "
        f"FAIL={runner.fail_count} "
        f"SKIP={runner.skip_count} "
        f"TOTAL={runner.total_count}"
    )


def step_0(session: requests.Session, state: dict[str, Any]) -> str:
    members = fetch_all_members(session)
    admin = find_member(members, user_id=ADMIN_ID) or find_member(members, phone=ADMIN_PHONE)
    if not admin:
        raise AssertionError(f"admin not found in members list, member_count={len(members)}")
    state["initial_admin_balance"] = balance_to_float(admin["balance"])
    return (
        f"admin_found id={admin['id']} name={admin['name']} phone={admin['phone']} "
        f"role={admin['role']} balance={state['initial_admin_balance']}"
    )


def step_0b(session: requests.Session, state: dict[str, Any]) -> str:
    payload = fetch_audit_log(session, page=1, page_size=20)
    total = get_total(payload)
    if total is None:
        raise AssertionError(f"audit total missing: {to_pretty(payload)}")
    state["initial_audit_total"] = total
    return f"initial_audit_total={total}"


def step_1(session: requests.Session, state: dict[str, Any]) -> str:
    payload = {
        "name": "E2E张三",
        "phone": "13900099001",
        "phone_number": "13900099001",
        "role": "member",
        "initial_balance": 200,
    }
    _, body = request_json(session, "POST", "/members", expected_status=200, json=payload)
    if not isinstance(body, dict):
        raise AssertionError(f"unexpected add member response: {to_pretty(body)}")
    new_id = body.get("id")
    if not isinstance(new_id, int):
        raise AssertionError(f"missing new member id in response: {to_pretty(body)}")
    state["new_id"] = new_id
    return f"created new_id={new_id}, response={to_pretty(body)}"


def step_2(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    members = fetch_all_members(session)
    member = find_member(members, user_id=new_id)
    if not member:
        raise AssertionError(f"new member not found for id={new_id}")
    assert_equal(member["name"], "E2E张三", "member.name")
    assert_equal(member["phone"], "13900099001", "member.phone")
    assert_close(balance_to_float(member["balance"]), 200.0, "member.balance")
    return f"member={to_pretty(member['raw'])}"


def step_3(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    payload = {"name": "E2E李四", "phone_number": "13900099002"}
    _, body = request_json(session, "PUT", f"/members/{new_id}", expected_status=200, json=payload)
    return f"updated id={new_id}, response={to_pretty(body)}"


def step_4(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    members = fetch_all_members(session)
    member = find_member(members, user_id=new_id)
    if not member:
        raise AssertionError(f"edited member not found for id={new_id}")
    assert_equal(member["name"], "E2E李四", "member.name")
    assert_equal(member["phone"], "13900099002", "member.phone")
    return f"member={to_pretty(member['raw'])}"


def step_5(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    wallet_before = fetch_wallet(session)
    state["wallet_total_before_first_distribute"] = float(wallet_before["total_balance"])
    payload = {
        "operator_id": ADMIN_ID,
        "target_user_id": new_id,
        "amount": 300,
        "remark": "E2E测试分发",
    }
    _, body = request_json(session, "POST", "/credits/distribute", expected_status=200, json=payload)
    return (
        f"response={to_pretty(body)}, "
        f"wallet_total_before_first_distribute={state['wallet_total_before_first_distribute']}"
    )


def step_6(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    initial_admin_balance = float(require_state("initial_admin_balance", "step 0 admin balance"))
    members = fetch_all_members(session)
    member = find_member(members, user_id=new_id)
    admin = find_member(members, user_id=ADMIN_ID) or find_member(members, phone=ADMIN_PHONE)
    if not member:
        raise AssertionError(f"member not found after distribute for id={new_id}")
    if not admin:
        raise AssertionError("admin not found after distribute")
    member_balance = balance_to_float(member["balance"])
    admin_balance = balance_to_float(admin["balance"])
    assert_close(member_balance, 500.0, "member.balance after step 5")
    assert_close(admin_balance, initial_admin_balance - 300.0, "admin.balance after step 5")
    state["member_balance_after_step6"] = member_balance
    state["admin_balance_after_step6"] = admin_balance
    return f"member_balance={member_balance}, admin_balance={admin_balance}"


def step_7(session: requests.Session, state: dict[str, Any], require_state) -> str:
    expected_total = float(
        require_state("wallet_total_before_first_distribute", "step 5 wallet baseline")
    )
    wallet = fetch_wallet(session)
    actual_total = float(wallet["total_balance"])
    assert_close(actual_total, expected_total, "wallet.total_balance")
    return f"wallet_total_before={expected_total}, wallet_total_after={actual_total}"


def step_8(session: requests.Session, state: dict[str, Any]) -> str:
    _ = state
    payload = fetch_transactions(session, page=1, page_size=5)
    items = get_items(payload)
    distribute_items = [
        item
        for item in items
        if item.get("change_type") == "DISTRIBUTE" and item.get("task_name") == "E2E测试分发"
    ]
    if not distribute_items:
        raise AssertionError(f"no DISTRIBUTE transaction found in first page: {to_pretty(items)}")
    return f"matched_records={to_pretty(distribute_items)}"


def step_9(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    payload = {
        "operator_id": new_id,
        "target_user_id": ADMIN_ID,
        "amount": 100,
        "remark": "E2E反向分发",
    }
    _, body = request_json(session, "POST", "/credits/distribute", expected_status=200, json=payload)
    return f"response={to_pretty(body)}"


def step_10(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    initial_admin_balance = float(require_state("initial_admin_balance", "step 0 admin balance"))
    members = fetch_all_members(session)
    member = find_member(members, user_id=new_id)
    admin = find_member(members, user_id=ADMIN_ID) or find_member(members, phone=ADMIN_PHONE)
    if not member:
        raise AssertionError(f"member not found after reverse distribute for id={new_id}")
    if not admin:
        raise AssertionError("admin not found after reverse distribute")
    member_balance = balance_to_float(member["balance"])
    admin_balance = balance_to_float(admin["balance"])
    assert_close(member_balance, 400.0, "member.balance after step 9")
    assert_close(admin_balance, initial_admin_balance - 200.0, "admin.balance after step 9")
    return f"member_balance={member_balance}, admin_balance={admin_balance}"


def step_11(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    initial_audit_total = int(require_state("initial_audit_total", "step 0b audit total"))
    payload = fetch_audit_log(session, page=1, page_size=20)
    total = get_total(payload)
    if total is None:
        raise AssertionError(f"audit total missing: {to_pretty(payload)}")
    items = get_items(payload)
    if total < initial_audit_total + 4:
        raise AssertionError(
            f"audit total should increase by at least 4, before={initial_audit_total}, after={total}"
        )
    add_member_ok = any(
        item.get("action") == "ADD_MEMBER" and item.get("target_user_id") == new_id for item in items
    )
    update_ok = any(
        item.get("action") == "MEMBER_UPDATE" and item.get("target_user_id") == new_id for item in items
    )
    distribute_forward_ok = any(
        item.get("action") == "TRANSFER_CREDITS"
        and item.get("operator_id") == ADMIN_ID
        and item.get("target_user_id") == new_id
        and int(item.get("credits_amount") or 0) == 300
        and item.get("remark") == "E2E测试分发"
        for item in items
    )
    distribute_reverse_ok = any(
        item.get("action") == "TRANSFER_CREDITS"
        and item.get("operator_id") == new_id
        and item.get("target_user_id") == ADMIN_ID
        and int(item.get("credits_amount") or 0) == 100
        and item.get("remark") == "E2E反向分发"
        for item in items
    )
    if not all([add_member_ok, update_ok, distribute_forward_ok, distribute_reverse_ok]):
        latest_actions = [item.get("action") for item in items[:10]]
        raise AssertionError(
            "audit log missing expected entries, "
            f"add_member_ok={add_member_ok}, update_ok={update_ok}, "
            f"distribute_forward_ok={distribute_forward_ok}, "
            f"distribute_reverse_ok={distribute_reverse_ok}, "
            f"latest_actions={latest_actions}"
        )
    state["audit_total_after_step11"] = total
    return f"audit_total_before={initial_audit_total}, audit_total_after={total}"


def step_12(session: requests.Session) -> str:
    payload = {
        "name": "E2E非法初始值",
        "phone": "13900009999",
        "phone_number": "13900009999",
        "role": "member",
        "initial_balance": -1,
    }
    response, body = request_json(session, "POST", "/members", json=payload)
    assert_equal(response.status_code, 422, "status")
    return f"status=422, response={to_pretty(body)}"


def step_13(session: requests.Session) -> str:
    payload = {
        "operator_id": ADMIN_ID,
        "target_user_id": ADMIN_ID,
        "amount": 0,
        "remark": "E2E amount zero",
    }
    response, body = request_json(session, "POST", "/credits/distribute", json=payload)
    assert_equal(response.status_code, 400, "status")
    return f"status=400, response={to_pretty(body)}"


def step_14(session: requests.Session, state: dict[str, Any]) -> str:
    target_user_id = state.get("new_id") or ADMIN_ID
    payload = {
        "operator_id": ADMIN_ID,
        "target_user_id": target_user_id,
        "amount": 999999999,
        "remark": "E2E余额不足",
    }
    response, body = request_json(session, "POST", "/credits/distribute", json=payload)
    assert_equal(response.status_code, 400, "status")
    return f"status=400, response={to_pretty(body)}"


def step_15(session: requests.Session) -> str:
    payload = {
        "operator_id": 99999999,
        "target_user_id": ADMIN_ID,
        "amount": 1,
        "remark": "E2E坏操作人",
    }
    response, body = request_json(session, "POST", "/credits/distribute", json=payload)
    assert_equal(response.status_code, 400, "status")
    return f"status=400, response={to_pretty(body)}"


def step_16(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    _, body = request_json(session, "DELETE", f"/members/{new_id}", expected_status=200)
    return f"deleted id={new_id}, response={to_pretty(body)}"


def step_17(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    members = fetch_all_members(session)
    member = find_member(members, user_id=new_id)
    if member is not None:
        raise AssertionError(f"member should be deleted but still exists: {to_pretty(member['raw'])}")
    return f"member id={new_id} absent from members list"


def step_18(session: requests.Session, state: dict[str, Any], require_state) -> str:
    new_id = require_state("new_id", "step 1 new_id")
    payload = fetch_audit_log(session, page=1, page_size=20)
    items = get_items(payload)
    remove_ok = any(
        item.get("action") == "REMOVE_MEMBER" and item.get("target_user_id") == new_id for item in items
    )
    if not remove_ok:
        latest_actions = [item.get("action") for item in items[:10]]
        raise AssertionError(f"REMOVE_MEMBER entry not found, latest_actions={latest_actions}")
    return f"REMOVE_MEMBER entry found for user_id={new_id}"


if __name__ == "__main__":
    main()
