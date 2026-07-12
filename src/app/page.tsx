"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type PointerSample = {
  x: number;
  y: number;
  pressure: number;
};

const MIN_WIDTH = 1.5;
const MAX_WIDTH = 18;

function widthForPressure(pressure: number) {
  // Pointer Events spec: mouse reports 0.5 while a button is held, 0 otherwise —
  // treat anything at or above that as "no real pressure data" and fall back to a mid-weight line.
  const p = pressure > 0 ? pressure : 0.5;
  return MIN_WIDTH + p * (MAX_WIDTH - MIN_WIDTH);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<PointerSample | null>(null);

  const [hud, setHud] = useState({
    pointerType: "—",
    pressure: 0,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const context = canvas.getContext("2d");
      context?.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): PointerSample {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure };
    }

    function drawSegment(from: PointerSample, to: PointerSample) {
      ctx!.beginPath();
      ctx!.moveTo(from.x, from.y);
      ctx!.lineTo(to.x, to.y);
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = widthForPressure(to.pressure);
      ctx!.strokeStyle = "#1f1934";
      ctx!.stroke();
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const p = pointFromEvent(e);
      lastPointRef.current = p;
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p.x), y: Math.round(p.y) });
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p.x), y: Math.round(p.y) });
      if (!drawingRef.current || !lastPointRef.current) return;
      drawSegment(lastPointRef.current, p);
      lastPointRef.current = p;
    }

    function onPointerUp(e: PointerEvent) {
      drawingRef.current = false;
      lastPointRef.current = null;
      canvas!.releasePointerCapture(e.pointerId);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>glypher — phase 0 spike</h1>
        <p>Write with a stylus, mouse, or finger. Watch pointerType and pressure below.</p>
      </header>
      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <dl className={styles.hud}>
          <dt>pointerType</dt>
          <dd>{hud.pointerType}</dd>
          <dt>pressure</dt>
          <dd>{hud.pressure.toFixed(2)}</dd>
          <dt>x, y</dt>
          <dd>{hud.x}, {hud.y}</dd>
        </dl>
        <button className={styles.clearBtn} onClick={handleClear} type="button">
          Clear
        </button>
      </div>
    </div>
  );
}
