    import React, { useEffect, useMemo, useRef, useState } from "react";
    import { CATEGORY_LABEL, SCENARIOS_BY_CATEGORY } from "./scenarios";
    import type { Scenario, Category } from "./scenarios";
    import { burnCpu, fakeRequest, sleep, HttpError } from "./scenarioRunner";

    // ---------- Simple UI helpers ----------
    function Card(props: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{props.title}</div>
        {props.children}
        </div>
    );
    }

    function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { style, ...rest } = props;
    return (
        <button
        {...rest}
        style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            width: "100%",
            ...style,
        }}
        />
    );
    }

    function Badge(props: { text: string }) {
    return (
        <span
        style={{
            display: "inline-block",
            padding: "2px 8px",
            border: "1px solid #ddd",
            borderRadius: 999,
            fontSize: 12,
            marginLeft: 8,
        }}
        >
        {props.text}
        </span>
    );
    }

    // ---------- Crash boundary ----------
    type CrashBoundaryProps = React.PropsWithChildren<{
    scenarioId: string;
    onBack: () => void;
    }>;

    type CrashBoundaryState = {
    hasError: boolean;
    error?: Error;
    };

    class CrashBoundary extends React.Component<CrashBoundaryProps, CrashBoundaryState> {
    constructor(props: CrashBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): CrashBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error) {
        console.error(`[BugFarm][${this.props.scenarioId}] crashed:`, error);
    }

    render() {
        if (this.state.hasError) {
        return (
            <div style={{ padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>Blank Screen / Crash</h2>
            <div style={{ marginBottom: 12 }}>
                Scenario: <code>{this.props.scenarioId}</code>
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: "#a00" }}>
                {this.state.error?.message ?? "Unknown error"}
            </div>
            <div style={{ marginTop: 16 }}>
                <Button onClick={this.props.onBack}>Back to Bug Farm</Button>
            </div>
            </div>
        );
        }
        return <>{this.props.children}</>;
    }
    }

    // ---------- Main page ----------
    export default function BugFarmPage() {
    const [selected, setSelected] = useState<Scenario | null>(null);

    // react-hooks/purity: avoid calling Date.now() during render; keep time in state
    const [startMs, setStartMs] = useState<number>(() => Date.now());
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    useEffect(() => {
        const t = window.setInterval(() => setNowMs(Date.now()), 200);
        return () => window.clearInterval(t);
    }, []);

    const elapsedSec = Math.max(0, (nowMs - startMs) / 1000);

    const resetToHome = () => {
        setSelected(null);
        setStartMs(Date.now());
    };

    if (!selected) {
        return (
        <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
            <h1 style={{ margin: "0 0 6px 0" }}>Bug Farm</h1>
            <div style={{ color: "#555", marginBottom: 12 }}>
            Controlled bug reproduction environment for recording benchmark videos.
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <Button onClick={() => setStartMs(Date.now())} style={{ width: 180 }}>
                Reset Timer
            </Button>
            <div>
                Timer: <code>{elapsedSec.toFixed(1)}s</code>
            </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {(Object.keys(SCENARIOS_BY_CATEGORY) as Category[]).map((cat) => (
                <Card key={cat} title={CATEGORY_LABEL[cat]}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 8 }}>
                    {SCENARIOS_BY_CATEGORY[cat].map((sc) => (
                    <Button
                        key={sc.id}
                        onClick={() => {
                        setSelected(sc);
                        setStartMs(Date.now());
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span>
                            <code>{sc.id}</code> — {sc.title}
                        </span>
                        <Badge text={sc.complexity} />
                        </div>
                    </Button>
                    ))}
                </div>
                </Card>
            ))}
            </div>

            <div style={{ marginTop: 16, color: "#666", fontSize: 13 }}>
            Recording tip: keep videos 15–60s. For half the cases, open DevTools Console/Network.
            </div>
        </div>
        );
    }

    return (
        <CrashBoundary scenarioId={selected.id} onBack={resetToHome}>
        <ScenarioView scenario={selected} onBack={resetToHome} />
        </CrashBoundary>
    );
    }

    // ---------- Scenario view ----------
    function ScenarioView(props: { scenario: Scenario; onBack: () => void }) {
    const { scenario } = props;

    const [log, setLog] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const [text, setText] = useState("");
    const [checkbox, setCheckbox] = useState(false);

    const [count, setCount] = useState(0);
    const [items, setItems] = useState<string[]>([]);
    const [tab, setTab] = useState<"A" | "B">("A");

    const [dark, setDark] = useState(false);
    const [layoutBroken, setLayoutBroken] = useState(false);
    const [longText, setLongText] = useState(false);
    const [overlayOn, setOverlayOn] = useState(false);

    const [route, setRoute] = useState<"home" | "details" | "not_found" | "login" | "restricted">("home");
    const [history, setHistory] = useState<("home" | "details" | "not_found" | "login" | "restricted")[]>(["home"]);

    const [token, setToken] = useState<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    tokenRef.current = token;

    // toast auto hide
    useEffect(() => {
        if (!toast) return;
        const ms = scenario.id === "error_message_04" ? 300 : 1500;
        const t = window.setTimeout(() => setToast(null), ms);
        return () => window.clearTimeout(t);
    }, [toast, scenario.id]);

    const addLog = (msg: string) =>
        setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 10));

    const go = (to: typeof route) => {
        if (scenario.id === "flow_nav_05" && to === "details") {
        setHistory(["details"]); // breaks back
        } else {
        setHistory((h) => [...h, to]);
        }
        setRoute(to);
    };

    const back = () => {
        if (history.length <= 1) return;
        const next = history[history.length - 2];
        setHistory((h) => h.slice(0, -1));
        setRoute(next);
    };

    useEffect(() => {
        setOverlayOn(scenario.id === "no_response_04");
    }, [scenario.id]);

    const containerStyle: React.CSSProperties = useMemo(
        () => ({
        padding: 16,
        minHeight: "100vh",
        background: dark ? "#111" : "#fafafa",
        // ui_issue_02: unreadable text in dark mode (same as bg)
        color: dark ? "#111" : "#111",
        }),
        [dark],
    );

    async function handlePrimaryAction() {
        addLog(`Primary action clicked for ${scenario.id}`);

        // Crash
        if (scenario.category === "crash") {
        if (scenario.id === "crash_01" || scenario.id === "crash_04" || scenario.id === "crash_05") {
            throw new Error("Uncaught: Crash triggered by user action");
        }
        if (scenario.id === "crash_02") {
            if (!text.trim()) {
            setToast({ type: "error", text: "Please type something first" });
            return;
            }
            throw new Error("Uncaught: Submit caused crash (null reference)");
        }
        if (scenario.id === "crash_03") {
            if (route !== "details") {
            setToast({ type: "error", text: "Go to Details first" });
            return;
            }
            throw new Error("Uncaught: Details page crashed");
        }
        }

        // No response
        if (scenario.category === "no_response") {
        if (scenario.id === "no_response_01") return;
        if (scenario.id === "no_response_02") {
            setToast({ type: "success", text: "Submitted" });
            return;
        }
        if (scenario.id === "no_response_03") {
            if (!checkbox) return; // silent failure
            setToast({ type: "success", text: "Submitted after prerequisite" });
            setCount((c) => c + 1);
            return;
        }
        if (scenario.id === "no_response_04") return;
        if (scenario.id === "no_response_05") return;
        }

        // UI issue
        if (scenario.category === "ui_issue") {
        if (scenario.id === "ui_issue_01") setLayoutBroken(true);
        if (scenario.id === "ui_issue_02") setDark((v) => !v);
        if (scenario.id === "ui_issue_05") setLongText((v) => !v);
        return;
        }

        // Data wrong
        if (scenario.category === "data_wrong") {
        if (scenario.id === "data_wrong_01") {
            setCount((c) => c + 1);
            return;
        }
        if (scenario.id === "data_wrong_02") {
            setItems((it) => [...it, `Item ${it.length + 1}`]);
            return;
        }
        if (scenario.id === "data_wrong_03") {
            setItems((it) => [...it, `Item ${it.length + 1}`]);
            return;
        }
        if (scenario.id === "data_wrong_04") {
            setItems((it) => [...it, `Item ${it.length + 1}`]);
            setCount((c) => c + 2); // mismatch on purpose
            return;
        }
        if (scenario.id === "data_wrong_05") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 600, status: 200 });
            setToast({ type: "success", text: "Fetched latest (but UI stale)" });
            } finally {
            setLoading(false);
            }
            return;
        }
        }

        // Flow / nav
        if (scenario.category === "flow_nav") {
        if (scenario.id === "flow_nav_01") {
            setToast({ type: "success", text: "Next clicked" });
            return;
        }
        if (scenario.id === "flow_nav_02") {
            go("not_found");
            return;
        }
        if (scenario.id === "flow_nav_03") {
            setToast({ type: "success", text: "Try Entry A or B" });
            return;
        }
        if (scenario.id === "flow_nav_04") {
            setLoading(true);
            await sleep(999999);
            return;
        }
        if (scenario.id === "flow_nav_05") {
            go("details");
            return;
        }
        }

        // Auth
        if (scenario.category === "auth") {
        if (scenario.id === "auth_01") {
            go("restricted");
            return;
        }
        if (scenario.id === "auth_02") {
            setLoading(true);
            try {
            if (!tokenRef.current) {
                await fakeRequest({ ms: 500, status: 401 });
            } else {
                await fakeRequest({ ms: 500, status: 200 });
            }
            } catch (err: unknown) {
            if (err instanceof HttpError && err.status === 401) {
                setToast({ type: "error", text: "401 Unauthorized" });
                go("login");
            } else {
                setToast({ type: "error", text: "Unknown error" });
            }
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "auth_03") {
            if (!tokenRef.current) {
            setToken("token_just_logged_in");
            setToast({ type: "success", text: "Logged in" });
            window.setTimeout(() => setToken(null), 300);
            return;
            }
            setLoading(true);
            try {
            if (!tokenRef.current) {
                await fakeRequest({ ms: 400, status: 401 });
            } else {
                await fakeRequest({ ms: 400, status: 200 });
            }
            } catch (err: unknown) {
            if (err instanceof HttpError && err.status === 401) {
                setToast({ type: "error", text: "Session expired (401)" });
                go("login");
            } else {
                setToast({ type: "error", text: "Unknown error" });
            }
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "auth_04") {
            go("restricted");
            return;
        }
        if (scenario.id === "auth_05") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 450, status: 403 });
            } catch (err: unknown) {
            if (err instanceof HttpError && err.status === 403) {
                setToast({ type: "error", text: "Unknown error" }); // misleading on purpose
            } else {
                setToast({ type: "error", text: "Unknown error" });
            }
            } finally {
            setLoading(false);
            }
            return;
        }
        }

        // Error message
        if (scenario.category === "error_message") {
        if (scenario.id === "error_message_01") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 350, status: 500 });
            } catch {
            // swallow intentionally
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "error_message_02") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 350, status: 401 });
            } catch {
            setToast({ type: "error", text: "Network error, please retry" }); // wrong
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "error_message_03") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 300, status: 500 });
            } catch {
            setToast({ type: "error", text: "Save failed" });
            window.setTimeout(() => setToast({ type: "error", text: "Save failed" }), 100);
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "error_message_04") {
            setLoading(true);
            try {
            await fakeRequest({ ms: 250, status: 500 });
            } catch {
            setToast({ type: "error", text: "Save failed (flashing)" });
            } finally {
            setLoading(false);
            }
            return;
        }
        if (scenario.id === "error_message_05") {
            setLoading(true);
            return; // never ends
        }
        }

        // Perf
        if (scenario.category === "perf") {
        if (scenario.id === "perf_01") {
            setLoading(true);
            await sleep(5000);
            setLoading(false);
            setToast({ type: "success", text: "Report loaded" });
            return;
        }
        if (scenario.id === "perf_02") {
            setItems(Array.from({ length: 2000 }, (_, i) => `Row ${i + 1}`));
            setToast({ type: "success", text: "Loaded heavy list" });
            return;
        }
        if (scenario.id === "perf_03") {
            setToast({ type: "success", text: "Type in the input; it will lag" });
            return;
        }
        if (scenario.id === "perf_04") {
            setLoading(true);
            const n = (count % 3) + 1;
            setCount((c) => c + 1);
            await sleep(1200 * n);
            setLoading(false);
            setToast({ type: "success", text: `Loaded after ${1200 * n}ms` });
            return;
        }
        if (scenario.id === "perf_05") {
            setLoading(true);
            await sleep(8000);
            setItems(Array.from({ length: 2500 }, (_, i) => `Row ${i + 1}`));
            setLoading(false);
            setToast({ type: "success", text: "Loaded slow + heavy render" });
            return;
        }
        }
    }

    // auth_04 redirect loop
    useEffect(() => {
        if (scenario.id !== "auth_04") return;
        if (route === "restricted") {
        const t = window.setTimeout(() => go("login"), 250);
        return () => window.clearTimeout(t);
        }
        if (route === "login") {
        const t = window.setTimeout(() => go("restricted"), 250);
        return () => window.clearTimeout(t);
        }
    }, [route, scenario.id]);

    const onTypeWithLag = (v: string) => {
        burnCpu(250_000);
        setText(v);
    };

    const headerStyle: React.CSSProperties = {
        position: scenario.id === "ui_issue_04" ? "sticky" : "static",
        top: 0,
        background: "#fff",
        padding: 10,
        borderBottom: "1px solid #ddd",
        zIndex: 50,
    };

    const contentTextColor = dark ? "#111" : "#111";

    return (
        <div style={containerStyle}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <Button onClick={props.onBack} style={{ width: 170 }}>
                Back to Home
            </Button>
            <div>
                Scenario: <code>{scenario.id}</code>
                <Badge text={scenario.complexity} />
            </div>
            <div style={{ marginLeft: "auto", color: "#666" }}>
                Category: <b>{scenario.category}</b>
            </div>
            </div>

            <div style={{ marginBottom: 10, color: "#444" }}>
            <b>Repro Steps (on-screen hints):</b>
            <ol style={{ margin: "6px 0 0 18px" }}>
                {scenario.hintSteps.map((x, i) => (
                <li key={i}>{x}</li>
                ))}
            </ol>
            </div>

            {toast && (
            <div
                style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                marginBottom: 10,
                background: toast.type === "error" ? "#fff0f0" : "#f3fff3",
                color: "#111",
                }}
            >
                {toast.text}
            </div>
            )}

            {scenario.id === "ui_issue_04" && (
            <div style={headerStyle}>
                <b style={{ color: "#111" }}>Sticky Header</b>{" "}
                <span style={{ color: "#111" }}>(scroll down; header may block clicks)</span>
            </div>
            )}

            <div
            style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
                background: "#fff",
                color: contentTextColor,
                position: "relative",
                overflow: "hidden",
            }}
            >
            {overlayOn && (
                <div
                title="Invisible overlay (blocks clicks)"
                style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(255,0,0,0.00)",
                    zIndex: 20,
                }}
                />
            )}

            {scenario.id === "ui_issue_05" && longText && (
                <div
                style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    right: 8,
                    padding: 10,
                    borderRadius: 10,
                    background: "#fffbe6",
                    border: "1px solid #f0d000",
                    zIndex: 10,
                }}
                >
                {"[LongText] ".repeat(80)}
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Controls</div>

                <div style={{ display: "grid", gap: 8 }}>
                    <Button onClick={handlePrimaryAction}>Primary Action</Button>

                    {scenario.id === "crash_03" && <Button onClick={() => go("details")}>Go to Details</Button>}

                    {scenario.category === "flow_nav" && scenario.id === "flow_nav_03" && (
                    <div style={{ display: "grid", gap: 8 }}>
                        <Button onClick={() => go("details")}>Entry A (works)</Button>
                        <Button onClick={() => go("not_found")}>Entry B (fails)</Button>
                    </div>
                    )}

                    {scenario.category === "flow_nav" && scenario.id === "flow_nav_05" && (
                    <Button onClick={back}>Back</Button>
                    )}

                    {scenario.category === "auth" && (
                    <div style={{ display: "grid", gap: 8 }}>
                        <Button
                        onClick={() => {
                            setToken("token_ok");
                            setToast({ type: "success", text: "Logged in (token set)" });
                        }}
                        >
                        Login
                        </Button>
                        <Button
                        onClick={() => {
                            setToken(null);
                            setToast({ type: "success", text: "Logged out (token cleared)" });
                        }}
                        >
                        Logout
                        </Button>
                        <Button onClick={() => go("restricted")}>Open Restricted</Button>
                    </div>
                    )}

                    {scenario.id === "ui_issue_02" && (
                    <Button onClick={() => setDark((v) => !v)}>Toggle Dark Mode</Button>
                    )}

                    {scenario.id === "ui_issue_01" && (
                    <Button onClick={() => setLayoutBroken(true)}>Break Layout</Button>
                    )}

                    {scenario.id === "ui_issue_05" && (
                    <Button onClick={() => setLongText((v) => !v)}>Toggle Long Text</Button>
                    )}

                    {scenario.category === "perf" && scenario.id === "perf_02" && (
                    <Button onClick={() => setItems(Array.from({ length: 2000 }, (_, i) => `Row ${i + 1}`))}>
                        Load Heavy List
                    </Button>
                    )}
                </div>

                <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Inputs</div>
                    <div style={{ display: "grid", gap: 8 }}>
                    <input
                        value={text}
                        onChange={(e) =>
                        scenario.id === "perf_03" ? onTypeWithLag(e.target.value) : setText(e.target.value)
                        }
                        placeholder="Type here..."
                        style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        }}
                    />

                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={checkbox} onChange={(e) => setCheckbox(e.target.checked)} />
                        <span>Prerequisite Checkbox</span>
                    </label>
                    </div>
                </div>
                </div>

                <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>UI Area</div>

                {(scenario.category === "flow_nav" || scenario.category === "auth") && (
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                        Route: <code>{route}</code>
                    </div>

                    {route === "home" && <div>Home Page</div>}
                    {route === "details" && <div>Details Page</div>}
                    {route === "not_found" && <div style={{ color: "#a00" }}>404 Not Found</div>}
                    {route === "login" && <div>Login Page</div>}
                    {route === "restricted" && (
                        <div>
                        Restricted Page{" "}
                        {!token ? (
                            <span style={{ color: "#a00" }}>— Not logged in</span>
                        ) : (
                            <span style={{ color: "#080" }}>— Access granted</span>
                        )}
                        </div>
                    )}
                    </div>
                )}

                {scenario.category === "ui_issue" && (
                    <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: layoutBroken ? "1fr" : "1fr 1fr",
                        gap: layoutBroken ? 0 : 10,
                        position: "relative",
                        minHeight: 160,
                        border: "1px solid #eee",
                        borderRadius: 12,
                        padding: 10,
                        overflow: "visible",
                    }}
                    >
                    <div
                        style={{
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        position: layoutBroken ? "absolute" : "static",
                        top: 10,
                        left: 10,
                        width: layoutBroken ? "80%" : "auto",
                        background: "#fff",
                        zIndex: 2,
                        }}
                    >
                        Card A
                    </div>
                    <div
                        style={{
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        position: layoutBroken ? "absolute" : "static",
                        top: 40,
                        left: 40,
                        width: layoutBroken ? "80%" : "auto",
                        background: "#fff",
                        zIndex: 1,
                        }}
                    >
                        Card B
                    </div>
                    <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
                        Resize the window to test responsive behavior (ui_issue_03).
                    </div>
                    </div>
                )}

                {scenario.category === "data_wrong" && (
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                        Counter: <b>{count}</b> | Items: <b>{items.length}</b> | Tab: <b>{tab}</b>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <Button
                        onClick={() => setTab("A")}
                        style={{ width: "50%", background: tab === "A" ? "#f0f0f0" : "white" }}
                        >
                        Tab A
                        </Button>
                        <Button
                        onClick={() => setTab("B")}
                        style={{ width: "50%", background: tab === "B" ? "#f0f0f0" : "white" }}
                        >
                        Tab B
                        </Button>
                    </div>

                    {scenario.id === "data_wrong_03" && tab === "B" ? (
                        <div style={{ color: "#666" }}>Tab B (does not reflect latest changes)</div>
                    ) : (
                        <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 140, overflow: "auto" }}>
                        {items.map((it) => (
                            <li key={it}>{it}</li>
                        ))}
                        </ul>
                    )}
                    </div>
                )}

                {scenario.category === "perf" && (
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    {(scenario.id === "perf_02" || scenario.id === "perf_05") ? (
                        <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid #ddd", borderRadius: 10 }}>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {items.map((it) => (
                            <li key={it}>{it}</li>
                            ))}
                        </ul>
                        </div>
                    ) : (
                        <div>Performance scenarios: use the controls (load/typing/repeat clicks).</div>
                    )}
                    </div>
                )}

                {(scenario.category === "no_response" || scenario.category === "error_message") && (
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                        Counter: <b>{count}</b> | Items: <b>{items.length}</b>
                    </div>
                    <div style={{ color: "#666" }}>
                        Watch for: no visible change, silent failure, wrong message, duplicate toast, flashing toast.
                    </div>
                    </div>
                )}
                </div>
            </div>

            {loading && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
                Loading...
                </div>
            )}
            </div>

            <div style={{ marginTop: 12 }}>
            <Card title="Local Log (for recording context)">
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                {log.length === 0 ? (
                    <div style={{ color: "#666" }}>No events yet.</div>
                ) : (
                    log.map((x, i) => (
                    <div key={i} style={{ borderBottom: "1px dashed #eee", padding: "4px 0" }}>
                        {x}
                    </div>
                    ))
                )}
                </div>
            </Card>
            </div>
        </div>
        </div>
    );
    }
