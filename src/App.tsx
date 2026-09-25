import { useState } from "react";
import { blankPlan, TEMPLATES } from "./model/templates";
import { useSimulation } from "./sim/client";
import { encodeShare } from "./state/persist";
import { useStore } from "./state/store";
import { PlanCanvas } from "./ui/canvas/PlanCanvas";
import { SetupFinder } from "./ui/SetupFinder";
import { LayersPanel, ReportPanel, TitleBlock, WindPanel } from "./ui/Sidebar";
import { StatusStrip } from "./ui/StatusStrip";
import { Tonight } from "./ui/Tonight";
import { Toolbar } from "./ui/Toolbar";
import { useKeyboard, usePersistence } from "./ui/useAppEffects";

export function App() {
  const sim = useSimulation();
  useKeyboard();
  usePersistence();
  const templateId = useStore((s) => s.templateId);
  const replacePlan = useStore((s) => s.replacePlan);
  const [shared, setShared] = useState<string | null>(null);

  const share = async () => {
    const st = useStore.getState();
    const code = await encodeShare({ plan: st.plan, weather: st.weather, templateId: st.templateId });
    const url = `${window.location.origin}${window.location.pathname}#p=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
    } catch {
      window.prompt("Copy this link", url);
      setShared("Link ready");
    }
    setTimeout(() => setShared(null), 2200);
  };

  return (
    <div className="sheet">
      <header className="masthead">
        <div className="brand">
          <h1>Windeye</h1>
          <p className="etym">
            <span className="sc">window</span>, from Old Norse <i>vindauga</i> — “wind-eye”
          </p>
        </div>
        <p className="lede">
          Draw your home, open a few windows, and watch the wind find its way through. A real fluid simulation
          — then it tells you which windows and where the fan.
        </p>
        <nav className="templates" aria-label="Start from a plan">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={templateId === t.id ? "on" : ""}
              title={t.blurb}
              onClick={() => replacePlan(t.make(), t.id)}
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            className={templateId === "blank" ? "on" : ""}
            onClick={() => replacePlan(blankPlan(), "blank")}
          >
            Blank sheet
          </button>
          <button type="button" className="share" onClick={share}>
            {shared ?? "Share plan"}
          </button>
        </nav>
      </header>
      <div className="workspace">
        <Toolbar />
        <main className="drawing">
          <div className="frame">
            <PlanCanvas />
            <span className="reg tl" />
            <span className="reg tr" />
            <span className="reg bl" />
            <span className="reg br" />
          </div>
          <StatusStrip onResetClock={sim.resetClock} />
        </main>
        <aside className="sidebar">
          <TitleBlock />
          <WindPanel />
          <LayersPanel />
          <ReportPanel />
          <SetupFinder />
          <Tonight />
          <footer className="colophon">
            2-D plan-view large-eddy simulation (lattice Boltzmann, D2Q9) driven by low-rise façade pressure
            coefficients. Good for comparing setups; it ignores stack effect and leaks. Runs entirely in your
            browser.
          </footer>
        </aside>
      </div>
    </div>
  );
}
