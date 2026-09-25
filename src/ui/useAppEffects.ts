import { useEffect } from "react";
import { deleteSelection, updateFan, updateFurniture } from "../model/ops";
import { decodeShare, loadLocal, saveLocal } from "../state/persist";
import { type Tool, useStore } from "../state/store";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  w: "wall",
  n: "window",
  d: "door",
  f: "fan",
  u: "furniture",
  l: "label",
  h: "pan",
};

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      )
        return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod) return;
      if ((e.key === "Delete" || e.key === "Backspace") && st.selection) {
        e.preventDefault();
        const sel = st.selection;
        st.setPlan((p) => deleteSelection(p, sel));
        st.select(null);
        return;
      }
      if (e.key === "Escape") {
        st.setTool("select");
        st.select(null);
        return;
      }
      if (e.key.toLowerCase() === "r" && st.selection) {
        const step = e.shiftKey ? Math.PI / 2 : Math.PI / 12;
        const sel = st.selection;
        if (sel.kind === "fan") {
          const f = st.plan.fans.find((x) => x.id === sel.id);
          if (f) st.setPlan((p) => updateFan(p, sel.id, { angle: f.angle + step }));
        } else if (sel.kind === "furniture") {
          const f = st.plan.furniture.find((x) => x.id === sel.id);
          if (f) st.setPlan((p) => updateFurniture(p, sel.id, { angle: f.angle + step }));
        }
        return;
      }
      if (e.key === " " && t?.tagName !== "BUTTON") return;
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) st.setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Restore from a share link (#p=…) or localStorage, then keep localStorage up to date. */
export function usePersistence() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = /[#&]p=([A-Za-z0-9_-]+)/.exec(window.location.hash);
      const saved = m ? await decodeShare(m[1]) : loadLocal();
      if (cancelled || !saved) return;
      const st = useStore.getState();
      st.replacePlan(saved.plan, saved.templateId);
      st.setWeather(saved.weather);
      useStore.setState({ past: [] });
      if (m) history.replaceState(null, "", window.location.pathname + window.location.search);
    })();
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.plan === prev.plan && s.weather === prev.weather) return;
      clearTimeout(t);
      t = setTimeout(() => saveLocal({ plan: s.plan, weather: s.weather, templateId: s.templateId }), 400);
    });
    return () => {
      cancelled = true;
      unsub();
      clearTimeout(t);
    };
  }, []);
}
