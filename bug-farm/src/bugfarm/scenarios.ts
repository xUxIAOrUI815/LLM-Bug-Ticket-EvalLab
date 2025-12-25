    export type Category =
    | "crash"
    | "no_response"
    | "ui_issue"
    | "data_wrong"
    | "flow_nav"
    | "auth"
    | "error_message"
    | "perf";

    export type Complexity = "C0" | "C1" | "C2" | "C3";

    export type Scenario = {
    id: string; // e.g. no_response_03
    category: Category;
    title: string;
    complexity: Complexity;
    hintSteps: string[]; // shown on screen for reproducibility
    };

    export const CATEGORY_LABEL: Record<Category, string> = {
    crash: "Crash / Blank Screen",
    no_response: "Interaction No Response",
    ui_issue: "UI Layout / Styling Issue",
    data_wrong: "Data Wrong / Not Updated",
    flow_nav: "Flow Stuck / Navigation Error",
    auth: "Auth / Permission",
    error_message: "Error Message / UX Error",
    perf: "Performance / Lag",
    };

    const s = (
    id: string,
    category: Category,
    title: string,
    complexity: Complexity,
    hintSteps: string[]
    ): Scenario => ({ id, category, title, complexity, hintSteps });

    export const SCENARIOS: Scenario[] = [
    // A) crash_01~05
    s("crash_01", "crash", "Click triggers immediate crash", "C0", [
        "Open scenario",
        "Click 'Trigger Crash'",
        "Observe blank screen / error overlay",
    ]),
    s("crash_02", "crash", "Type then submit to crash", "C1", [
        "Type any text in input",
        "Click 'Submit'",
        "Observe crash",
    ]),
    s("crash_03", "crash", "Navigate then crash on details page", "C2", [
        "Click 'Go to Details'",
        "On details page, click 'Trigger Crash'",
        "Observe crash",
    ]),
    s("crash_04", "crash", "Noisy actions then crash", "C3", [
        "Scroll up/down",
        "Click random toggles",
        "Click 'Trigger Crash'",
    ]),
    s("crash_05", "crash", "Crash with console hint (open DevTools)", "C1", [
        "Open DevTools Console",
        "Click 'Trigger Crash'",
        "Observe error stack trace",
    ]),

    // B) no_response_01~05
    s("no_response_01", "no_response", "Submit button does nothing", "C0", [
        "Click 'Submit'",
        "Observe no UI change",
    ]),
    s(
        "no_response_02",
        "no_response",
        "Fake success toast, no state change",
        "C1",
        ["Click 'Submit'", "Toast shows success", "Observe list/count unchanged"]
    ),
    s(
        "no_response_03",
        "no_response",
        "Hidden prerequisite (checkbox) with no hint",
        "C2",
        [
        "Click 'Submit' (nothing happens)",
        "Try again after toggling checkbox",
        "Observe only then it works",
        ]
    ),
    s(
        "no_response_04",
        "no_response",
        "Transparent overlay blocks clicks",
        "C3",
        [
        "Try clicking 'Submit' repeatedly",
        "Observe click is blocked by invisible layer",
        ]
    ),
    s(
        "no_response_05",
        "no_response",
        "Should request API but nothing sent",
        "C1",
        ["Click 'Submit'", "Observe no request indicator, no UI change"]
    ),

    // C) ui_issue_01~05
    s("ui_issue_01", "ui_issue", "Break layout: cards overlap", "C0", [
        "Click 'Break Layout'",
        "Observe overlapping cards",
    ]),
    s("ui_issue_02", "ui_issue", "Dark mode makes text unreadable", "C1", [
        "Toggle Dark Mode",
        "Observe text becomes hard to read",
    ]),
    s("ui_issue_03", "ui_issue", "Resize causes responsive break", "C2", [
        "Resize window narrower",
        "Observe content overflow / misalignment",
    ]),
    s(
        "ui_issue_04",
        "ui_issue",
        "Sticky header blocks content after scroll",
        "C3",
        [
        "Scroll down",
        "Try clicking button under header",
        "Observe header blocks it",
        ]
    ),
    s("ui_issue_05", "ui_issue", "Long i18n text overflows and covers UI", "C1", [
        "Switch to 'Long Text' mode",
        "Observe overflow covers buttons",
    ]),

    // D) data_wrong_01~05
    s(
        "data_wrong_01",
        "data_wrong",
        "Add item: counter increases but list not updated",
        "C0",
        ["Click 'Add Item'", "Observe counter increments", "List unchanged"]
    ),
    s(
        "data_wrong_02",
        "data_wrong",
        "List updates but counter not updated",
        "C1",
        ["Click 'Add Item'", "Observe list gets new item", "Counter unchanged"]
    ),
    s("data_wrong_03", "data_wrong", "Tab switch shows stale data", "C2", [
        "Add an item",
        "Switch to other tab and back",
        "Observe stale list",
    ]),
    s(
        "data_wrong_04",
        "data_wrong",
        "Rapid clicks cause count mismatch (race)",
        "C3",
        [
        "Double-click 'Add Item' quickly",
        "Observe mismatch between counter and list",
        ]
    ),
    s("data_wrong_05", "data_wrong", "Mock API success but UI stale", "C1", [
        "Click 'Fetch Latest'",
        "Observe success indicator",
        "UI data unchanged",
    ]),

    // E) flow_nav_01~05
    s("flow_nav_01", "flow_nav", "Next step does not navigate (stuck)", "C0", [
        "Click 'Next'",
        "Observe still on the same step",
    ]),
    s("flow_nav_02", "flow_nav", "Navigates to Not Found (404)", "C1", [
        "Click 'Go to Details'",
        "Observe 404 page",
    ]),
    s(
        "flow_nav_03",
        "flow_nav",
        "Entry A ok, Entry B fails (missing param)",
        "C2",
        ["Click 'Entry A' then back (works)", "Click 'Entry B' (fails)"]
    ),
    s(
        "flow_nav_04",
        "flow_nav",
        "Infinite loading (promise never resolves)",
        "C3",
        ["Click 'Submit'", "Observe loading spinner never ends"]
    ),
    s("flow_nav_05", "flow_nav", "Back button behaves unexpectedly", "C1", [
        "Go to subpage",
        "Click 'Back'",
        "Observe it doesn't return to expected page",
    ]),

    // F) auth_01~05
    s("auth_01", "auth", "Restricted page shows Not logged in", "C0", [
        "Click 'Open Restricted'",
        "Observe not logged in message",
    ]),
    s("auth_02", "auth", "Action returns 401 then redirects to login", "C1", [
        "Click 'Do Action'",
        "Observe 401 and redirect",
    ]),
    s("auth_03", "auth", "Login then token expires immediately", "C2", [
        "Click 'Login'",
        "Click 'Do Action' (fails due to expiry)",
    ]),
    s("auth_04", "auth", "Redirect loop between login and restricted", "C3", [
        "Click 'Open Restricted'",
        "Observe redirect loop",
    ]),
    s("auth_05", "auth", "403 shown as unknown error (misleading)", "C1", [
        "Click 'Do Admin Action'",
        "Observe 403 but wrong message",
    ]),

    // G) error_message_01~05
    s(
        "error_message_01",
        "error_message",
        "Request fails but no error message shown",
        "C0",
        ["Click 'Save'", "Observe it fails silently"]
    ),
    s(
        "error_message_02",
        "error_message",
        "Wrong error text for actual failure",
        "C1",
        ["Click 'Save'", "Observe message mismatched to error"]
    ),
    s(
        "error_message_03",
        "error_message",
        "Duplicate toasts for one error",
        "C2",
        ["Click 'Save'", "Observe duplicate error toasts"]
    ),
    s("error_message_04", "error_message", "Error toast flashes briefly", "C3", [
        "Click 'Save'",
        "Observe toast disappears quickly",
    ]),
    s(
        "error_message_05",
        "error_message",
        "Loading never ends and no error",
        "C1",
        ["Click 'Save'", "Observe spinner stays, no message"]
    ),

    // H) perf_01~05
    s("perf_01", "perf", "Slow fetch: result appears after 5s", "C0", [
        "Click 'Load Report'",
        "Observe loading ~5s",
    ]),
    s("perf_02", "perf", "Heavy list causes scroll lag", "C1", [
        "Scroll the list",
        "Observe lag / stutter",
    ]),
    s("perf_03", "perf", "Typing is delayed due to heavy computation", "C2", [
        "Type in input quickly",
        "Observe delayed updates",
    ]),
    s("perf_04", "perf", "Repeated clicks make it slower (queue)", "C3", [
        "Click 'Load Report' 3 times quickly",
        "Observe increasing delay",
    ]),
    s("perf_05", "perf", "Slow network + heavy render combined", "C1", [
        "Click 'Load Report'",
        "Observe long wait, then heavy render stutter",
    ]),
    ];

    export const SCENARIOS_BY_CATEGORY: Record<Category, Scenario[]> =
    SCENARIOS.reduce(
        (acc, sc) => {
        acc[sc.category].push(sc);
        return acc;
        },
        {
        crash: [],
        no_response: [],
        ui_issue: [],
        data_wrong: [],
        flow_nav: [],
        auth: [],
        error_message: [],
        perf: [],
        } as Record<Category, Scenario[]>
    );
