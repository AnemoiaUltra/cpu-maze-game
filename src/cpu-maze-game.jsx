
import { useState, useEffect, useRef, useCallback } from "react";

// ── constants ──────────────────────────────────────────────────────────────────
const TILE = 32;
const COLS = 28;
const ROWS = 22;

// Tile types
const T = { WALL: 0, FLOOR: 1, COMPONENT: 2, BUS: 3 };

// Component colors
const COMP_COLORS = {
  PC:      { bg: "#00ff9d", fg: "#000" },
  MAR:     { bg: "#00cfff", fg: "#000" },
  IR:      { bg: "#ffb800", fg: "#000" },
  MBR:     { bg: "#ff6b35", fg: "#000" },
  CU:      { bg: "#c084fc", fg: "#000" },
  MEMORY:  { bg: "#f43f5e", fg: "#fff" },
  ADDR:    { bg: "#00cfff", fg: "#000", label: "ADDRESS BUS" },
  DATA:    { bg: "#00ff9d", fg: "#000", label: "DATA BUS" },
  CTRL:    { bg: "#ffb800", fg: "#000", label: "CTRL BUS" },
};

// Component zones: { id, label, x, y, w, h } — grid-cell rectangles
const COMPONENTS = [
  { id: "PC",     label: "PC",           x: 2,  y: 3,  w: 3, h: 2 },
  { id: "MAR",    label: "MAR",          x: 8,  y: 3,  w: 3, h: 2 },
  { id: "IR",     label: "IR",           x: 2,  y: 12, w: 3, h: 2 },
  { id: "MBR",    label: "MBR",          x: 8,  y: 12, w: 3, h: 2 },
  { id: "CU",     label: "Control Unit", x: 5,  y: 8,  w: 4, h: 3 },
  { id: "MEMORY", label: "Memory",       x: 20, y: 6,  w: 5, h: 9 },
  { id: "ADDR",   label: "ADDR BUS",     x: 15, y: 4,  w: 2, h: 14, bus: true },
  { id: "DATA",   label: "DATA BUS",     x: 17, y: 4,  w: 2, h: 14, bus: true },
  { id: "CTRL",   label: "CTRL BUS",     x: 19, y: 4,  w: 1, h: 14, bus: true },
];

// Tasks for each cycle
const ALL_TASKS = {
  fetch: [
    {
      id: "fetch_pc_mar",
      text: "PC → MAR",
      hint: "Move program counter address to MAR",
      target: "MAR",
      explanation: "The Program Counter holds the address of the next instruction. It transfers this address to the Memory Address Register (MAR) so the CPU knows where in memory to look.",
    },
    {
      id: "fetch_mar_addr",
      text: "MAR → Address Bus",
      hint: "Send address onto the address bus",
      target: "ADDR",
      explanation: "MAR places the instruction address on the Address Bus, which carries it to main memory. This is how the CPU tells memory 'I want what's stored here.'",
    },
    {
      id: "fetch_mem_mbr",
      text: "Memory → MBR (via Data Bus)",
      hint: "Fetch instruction from memory into MBR",
      target: "MBR",
      explanation: "Memory reads the requested address and sends the instruction back over the Data Bus into the Memory Buffer Register (MBR). MBR is the staging area for all data moving between CPU and memory.",
    },
    {
      id: "fetch_mbr_ir",
      text: "MBR → IR",
      hint: "Move instruction from MBR to IR",
      target: "IR",
      explanation: "The instruction is moved from MBR into the Instruction Register (IR). The IR holds the current instruction so the Control Unit can decode and execute it.",
    },
    {
      id: "fetch_pc_inc",
      text: "PC + 1 (visit CU)",
      hint: "Increment the program counter via Control Unit",
      target: "CU",
      explanation: "The Control Unit increments the Program Counter so it now points to the next instruction. This ensures sequential execution unless a branch overrides it.",
    },
  ],
  indirect: [
    {
      id: "ind_ir_mar",
      text: "IR(addr) → MAR",
      hint: "Send effective address from IR to MAR",
      target: "MAR",
      explanation: "In indirect addressing, the IR contains not the data but a pointer. That pointer (address) is sent to MAR so the CPU can look up the actual operand address in memory.",
    },
    {
      id: "ind_mar_bus",
      text: "MAR → Address Bus",
      hint: "Put pointer address on the bus",
      target: "ADDR",
      explanation: "MAR places the pointer address on the Address Bus. Memory will be read at this location to find the real operand address.",
    },
    {
      id: "ind_mem_mbr",
      text: "Memory → MBR",
      hint: "Fetch real address from memory",
      target: "MBR",
      explanation: "Memory returns the actual operand address through the Data Bus into MBR. This is the 'real' address that will be used for the operation — indirect addressing adds this extra memory lookup.",
    },
    {
      id: "ind_mbr_ir",
      text: "MBR → IR(addr)",
      hint: "Update IR with the real operand address",
      target: "IR",
      explanation: "The real operand address from MBR replaces the pointer in IR's address field. Now the instruction knows exactly where to find or store data.",
    },
  ],
  interrupt: [
    {
      id: "int_cu_mbr",
      text: "PC → MBR (save state)",
      hint: "Save current PC through MBR",
      target: "MBR",
      explanation: "When an interrupt occurs, the current state must be saved. The Program Counter value is copied to MBR so it can be stored in memory — allowing the CPU to return here after handling the interrupt.",
    },
    {
      id: "int_mbr_mem",
      text: "MBR → Memory (push)",
      hint: "Push saved PC onto the stack in memory",
      target: "MEMORY",
      explanation: "MBR sends the saved PC value through the Data Bus to memory (typically the stack). This preserves the return address so normal execution can resume after the interrupt service routine.",
    },
    {
      id: "int_cu_mar",
      text: "Interrupt Vector → MAR",
      hint: "Load interrupt vector address into MAR",
      target: "MAR",
      explanation: "The Control Unit loads the interrupt vector address into MAR. The interrupt vector table maps each interrupt type to the address of its handler routine.",
    },
    {
      id: "int_mar_pc",
      text: "Handler Address → PC (via CU)",
      hint: "Jump to interrupt handler",
      target: "CU",
      explanation: "The Control Unit reads the handler address and updates the Program Counter to point to the interrupt service routine (ISR). Execution now jumps to the ISR to handle the interrupt.",
    },
  ],
};

const CYCLES = [
  { key: "fetch",    label: "FETCH CYCLE",    color: "#00ff9d" },
  { key: "indirect", label: "INDIRECT CYCLE", color: "#00cfff" },
  { key: "interrupt",label: "INTERRUPT CYCLE",color: "#f43f5e" },
];

// Build walkable map: 0 = wall, 1 = floor, 2 = component, 3 = bus
function buildMap() {
  const map = Array.from({ length: ROWS }, () => Array(COLS).fill(T.FLOOR));
  // outer walls
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) map[r][c] = T.WALL;
  }
  // internal walls — create corridors between components
  // Horizontal wall rows
  [2, 7, 11, 16, 18].forEach(row => {
    for (let c = 1; c < COLS - 1; c++) map[row][c] = T.WALL;
  });
  // Vertical wall columns
  [6, 13, 14, 25].forEach(col => {
    for (let r = 1; r < ROWS - 1; r++) map[r][col] = T.WALL;
  });

  // carve corridors (openings in walls)
  // vertical walls openings
  [[2,4],[2,10],[2,14],[7,5],[7,9],[7,14],[11,5],[11,9],[11,14],
   [16,5],[16,9],[16,14],[18,5],[18,9],[18,14]].forEach(([r,c])=>{
    if (r<ROWS && c<COLS) map[r][c]=T.FLOOR;
  });
  [[3,6],[4,6],[5,6],[8,6],[9,6],[10,6],[12,6],[13,6],[14,6],[15,6],
   [3,13],[4,13],[8,13],[9,13],[12,13],[13,13],[14,13],[15,13],
   [3,14],[8,14],[9,14],[12,14],[3,25],[8,25],[12,25]].forEach(([r,c])=>{
    if (r<ROWS && c<COLS) map[r][c]=T.FLOOR;
  });

  // stamp components
  COMPONENTS.forEach(comp => {
    const type = comp.bus ? T.BUS : T.COMPONENT;
    for (let dr = 0; dr < comp.h; dr++) for (let dc = 0; dc < comp.w; dc++) {
      const r = comp.y + dr, c = comp.x + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) map[r][c] = type;
    }
  });
  return map;
}

// Get which component the player is on (center tile)
function getComponentAt(px, py) {
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  for (const comp of COMPONENTS) {
    if (col >= comp.x && col < comp.x + comp.w && row >= comp.y && row < comp.y + comp.h) {
      return comp.id;
    }
  }
  return null;
}

// ── Game component ─────────────────────────────────────────────────────────────
export default function CPUMazeGame() {
  const canvasRef = useRef(null);
  const [map] = useState(buildMap);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [taskIdx, setTaskIdx] = useState(0);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [log, setLog] = useState([]);
  const [modal, setModal] = useState(null); // { title, text }
  const [gamePhase, setGamePhase] = useState("playing"); // playing | cycleComplete | allDone | gameOver
  const [hearts, setHearts] = useState(3);
  const [flash, setFlash] = useState(null); // component id being flashed
  const [visitedComp, setVisitedComp] = useState(null);
  const [particles, setParticles] = useState([]);

  const playerRef = useRef({ x: TILE * 3.5, y: TILE * 5.5, vx: 0, vy: 0 });
  const keysRef = useRef({});
  const animRef = useRef(null);
  const lastCompRef = useRef(null);

  const cycle = CYCLES[cycleIdx];
  const tasks = ALL_TASKS[cycle.key];
  const currentTask = tasks[taskIdx];

  // Particle effect helper
  const spawnParticles = useCallback((cx, cy, color) => {
    const ps = Array.from({ length: 12 }, (_, i) => ({
      id: Date.now() + i,
      x: cx, y: cy,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 1, color,
    }));
    setParticles(prev => [...prev, ...ps]);
    setTimeout(() => setParticles(prev => prev.filter(p => !ps.find(q => q.id === p.id))), 800);
  }, []);

  // Handle task completion
  const handleComponentVisit = useCallback((compId) => {
    if (gamePhase !== "playing" || !currentTask) return;
    if (compId !== currentTask.target) {
      // wrong component — lose a heart
      setLog(prev => [`💔 Wrong! Need: ${currentTask.target}`, ...prev].slice(0, 8));
      setHearts(prev => {
        const next = prev - 1;
        if (next <= 0) {
          setGamePhase("gameOver");
        }
        return next;
      });
      return;
    }
    // Correct!
    setFlash(compId);
    setTimeout(() => setFlash(null), 600);
    spawnParticles(
      (COMPONENTS.find(c=>c.id===compId)?.x ?? 10) * TILE + TILE,
      (COMPONENTS.find(c=>c.id===compId)?.y ?? 5) * TILE + TILE,
      COMP_COLORS[compId]?.bg ?? "#0f0",
    );

    const done = [...completedTasks, currentTask.id];
    setCompletedTasks(done);
    setLog(prev => [`✅ ${currentTask.text}`, ...prev].slice(0, 8));

    const nextIdx = taskIdx + 1;
    const isLastTask = nextIdx >= tasks.length;
    const isLastCycle = cycleIdx + 1 >= CYCLES.length;

    setModal({
      title: `✅ ${currentTask.text}`,
      text: currentTask.explanation,
      color: cycle.color,
      onClose: () => {
        setModal(null);
        if (isLastTask) {
          setTaskIdx(0);
          if (isLastCycle) {
            setGamePhase("allDone");
          } else {
            setGamePhase("cycleComplete");
          }
        } else {
          setTaskIdx(nextIdx);
        }
      },
    });
  }, [gamePhase, currentTask, completedTasks, taskIdx, tasks, cycleIdx, cycle, spawnParticles]);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const SPEED = 2.8;

    function tick() {
      const p = playerRef.current;
      const keys = keysRef.current;
      p.vx = 0; p.vy = 0;
      if (keys["ArrowLeft"]  || keys["a"]) p.vx = -SPEED;
      if (keys["ArrowRight"] || keys["d"]) p.vx =  SPEED;
      if (keys["ArrowUp"]    || keys["w"]) p.vy = -SPEED;
      if (keys["ArrowDown"]  || keys["s"]) p.vy =  SPEED;

      // Diagonal normalise
      if (p.vx && p.vy) { p.vx *= 0.707; p.vy *= 0.707; }

      // Collision
      const R = 10; // player radius
      const tryMove = (nx, ny) => {
        const tileAt = (x, y) => {
          const col = Math.floor(x / TILE);
          const row = Math.floor(y / TILE);
          return (row < 0 || row >= ROWS || col < 0 || col >= COLS) ? T.WALL : map[row][col];
        };
        const corners = [
          [nx - R, ny - R], [nx + R, ny - R],
          [nx - R, ny + R], [nx + R, ny + R],
        ];
        return corners.every(([cx, cy]) => tileAt(cx, cy) !== T.WALL);
      };

      if (tryMove(p.x + p.vx, p.y)) p.x += p.vx;
      if (tryMove(p.x, p.y + p.vy)) p.y += p.vy;

      // Check component
      const onComp = getComponentAt(p.x, p.y);
      if (onComp && onComp !== lastCompRef.current) {
        lastCompRef.current = onComp;
        setVisitedComp(onComp);
        handleComponentVisit(onComp);
      } else if (!onComp) {
        lastCompRef.current = null;
        setVisitedComp(null);
      }

      // ── Draw ──────────────────────────────────────────────────
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid tiles
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = map[r][c];
          const x = c * TILE, y = r * TILE;
          if (t === T.WALL) {
            ctx.fillStyle = "#1a1a2e";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.strokeStyle = "#16213e";
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, TILE, TILE);
          } else if (t === T.FLOOR) {
            ctx.fillStyle = "#0d0d1a";
            ctx.fillRect(x, y, TILE, TILE);
            // subtle grid dot
            ctx.fillStyle = "#1a1a35";
            ctx.fillRect(x + 15, y + 15, 2, 2);
          }
        }
      }

      // Components
      COMPONENTS.forEach(comp => {
        const cx = comp.x * TILE, cy = comp.y * TILE;
        const cw = comp.w * TILE, ch = comp.h * TILE;
        const col = COMP_COLORS[comp.id] ?? { bg: "#333", fg: "#fff" };
        const isFlashing = flash === comp.id;
        const isVisited = visitedComp === comp.id;
        const isTarget = currentTask && comp.id === currentTask.target && gamePhase === "playing";

        // Glow
        if (isTarget) {
          ctx.shadowColor = col.bg;
          ctx.shadowBlur = 18;
        } else {
          ctx.shadowBlur = 0;
        }

        // Fill
        if (isFlashing) {
          ctx.fillStyle = "#ffffff";
        } else if (comp.bus) {
          ctx.fillStyle = col.bg + "22";
        } else {
          ctx.fillStyle = isVisited ? col.bg + "cc" : col.bg + "44";
        }
        ctx.fillRect(cx + 2, cy + 2, cw - 4, ch - 4);

        // Border
        ctx.strokeStyle = isFlashing ? "#fff" : (isTarget ? col.bg : col.bg + "88");
        ctx.lineWidth = isTarget ? 2.5 : 1.5;
        ctx.strokeRect(cx + 2, cy + 2, cw - 4, ch - 4);
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = isFlashing ? "#000" : col.bg;
        ctx.font = comp.bus
          ? `bold ${Math.min(10, (cw - 4) / (comp.label?.length ?? 3) * 1.5)}px monospace`
          : `bold ${Math.min(11, cw / 3.5)}px 'Courier New', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (comp.bus) {
          ctx.save();
          ctx.translate(cx + cw / 2, cy + ch / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(comp.label ?? comp.id, 0, 0);
          ctx.restore();
        } else {
          const lines = comp.label.split(" ");
          lines.forEach((line, i) => {
            ctx.fillText(line, cx + cw / 2, cy + ch / 2 + (i - (lines.length - 1) / 2) * 13);
          });
        }

        // Target pulse ring
        if (isTarget && !isFlashing) {
          const t = Date.now() / 600;
          const alpha = (Math.sin(t) + 1) / 2;
          ctx.strokeStyle = col.bg + Math.floor(alpha * 255).toString(16).padStart(2, "0");
          ctx.lineWidth = 3;
          ctx.strokeRect(cx - 2, cy - 2, cw + 4, ch + 4);
        }
      });

      // Player
      const px = playerRef.current.x, py = playerRef.current.y;
      const t2 = Date.now() / 400;

      // Trail
      ctx.shadowColor = "#00ff9d";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#00ff9d";
      ctx.fill();

      // Direction indicator
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();

      // Player pulse
      ctx.beginPath();
      ctx.arc(px, py, 7 + Math.sin(t2) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#00ff9d44";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [map, flash, visitedComp, currentTask, gamePhase, handleComponentVisit]);

  // Key events
  useEffect(() => {
    const down = e => { keysRef.current[e.key] = true; e.preventDefault(); };
    const up   = e => { keysRef.current[e.key] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Mobile controls
  const mobileDir = (dir, active) => {
    keysRef.current[dir] = active;
  };

  const advanceCycle = () => {
    setCompletedTasks([]);
    setTaskIdx(0);
    setCycleIdx(prev => prev + 1);
    setGamePhase("playing");
    setHearts(3);
    // reset player position
    playerRef.current = { x: TILE * 3.5, y: TILE * 5.5, vx: 0, vy: 0 };
    lastCompRef.current = null;
  };

  const restart = () => {
    setCycleIdx(0);
    setTaskIdx(0);
    setCompletedTasks([]);
    setLog([]);
    setHearts(3);
    setGamePhase("playing");
    setModal(null);
    playerRef.current = { x: TILE * 3.5, y: TILE * 5.5, vx: 0, vy: 0 };
    lastCompRef.current = null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const W = COLS * TILE;
  const H = ROWS * TILE;

  return (
    <div style={{
      fontFamily: "'Courier New', monospace",
      background: "#060610",
      minHeight: "100vh",
      color: "#e0e0ff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "16px",
      gap: 12,
      userSelect: "none",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: 6, color: "#555", marginBottom: 2 }}>
          COMPUTER ORGANISATION & ARCHITECTURE
        </div>
        <h1 style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 900,
          letterSpacing: 3,
          color: cycle.color,
          textShadow: `0 0 20px ${cycle.color}88`,
        }}>
          CPU DATA FLOW SIMULATOR
        </h1>
        <div style={{
          marginTop: 4,
          fontSize: 13,
          letterSpacing: 4,
          color: cycle.color + "cc",
          textTransform: "uppercase",
        }}>
          {cycle.label}
        </div>
        {/* Hearts */}
        <div style={{ marginTop: 8, fontSize: 22, letterSpacing: 4 }}>
          {[1,2,3].map(i => (
            <span key={i} style={{ opacity: i <= hearts ? 1 : 0.15, filter: i <= hearts ? "drop-shadow(0 0 6px #f43f5e)" : "none" }}>
              ❤️
            </span>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>

        {/* Canvas */}
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{
              border: `2px solid ${cycle.color}55`,
              boxShadow: `0 0 30px ${cycle.color}22`,
              display: "block",
              maxWidth: "100%",
            }}
          />
          {/* Particle overlay (CSS-only, canvas handles actual particles in draw loop) */}

          {/* Modal overlay */}
          {modal && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "#000000cc",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}>
              <div style={{
                background: "#0d0d1a",
                border: `2px solid ${modal.color}`,
                boxShadow: `0 0 40px ${modal.color}55`,
                borderRadius: 8,
                padding: "20px 24px",
                maxWidth: 340,
                animation: "fadeIn 0.2s ease",
                position: "relative",
              }}>
                {/* X close button */}
                <button
                  onClick={modal.onClose}
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 10,
                    background: "transparent",
                    border: "none",
                    color: modal.color,
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: "2px 6px",
                    fontFamily: "inherit",
                  }}
                >✕</button>
                <div style={{ fontSize: 15, color: modal.color, fontWeight: 700, marginBottom: 8, paddingLeft: 24 }}>
                  {modal.title}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: "#ccc" }}>
                  {modal.text}
                </div>
              </div>
            </div>
          )}

          {/* Game Over overlay */}
          {gamePhase === "gameOver" && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "#000000ee",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}>
              <div style={{ fontSize: 32, color: "#f43f5e", fontWeight: 900, letterSpacing: 3, textShadow: "0 0 30px #f43f5e88" }}>
                GAME OVER
              </div>
              <div style={{ fontSize: 13, color: "#aaa", maxWidth: 280, textAlign: "center", lineHeight: 1.7 }}>
                You ran out of hearts. Review the CPU components and try again!
              </div>
              <button
                onClick={restart}
                style={{
                  background: "transparent",
                  border: "2px solid #f43f5e",
                  color: "#f43f5e",
                  padding: "10px 28px",
                  fontSize: 13,
                  letterSpacing: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                TRY AGAIN
              </button>
            </div>
          )}

          {/* Cycle complete overlay */}
          {gamePhase === "cycleComplete" && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "#000000dd",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}>
              <div style={{ fontSize: 28, color: cycle.color, fontWeight: 900, letterSpacing: 3 }}>
                CYCLE COMPLETE!
              </div>
              <div style={{ fontSize: 13, color: "#aaa", maxWidth: 280, textAlign: "center" }}>
                You successfully simulated the {cycle.label}. Ready for the next cycle?
              </div>
              <button
                onClick={advanceCycle}
                style={{
                  background: "transparent",
                  border: `2px solid ${CYCLES[cycleIdx + 1]?.color ?? "#0f0"}`,
                  color: CYCLES[cycleIdx + 1]?.color ?? "#0f0",
                  padding: "10px 28px",
                  fontSize: 13,
                  letterSpacing: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                START {CYCLES[cycleIdx + 1]?.label ?? ""}
              </button>
            </div>
          )}

          {gamePhase === "allDone" && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "#000000ee",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}>
              <div style={{ fontSize: 26, color: "#00ff9d", fontWeight: 900, letterSpacing: 3 }}>
                🎉 ALL CYCLES COMPLETE!
              </div>
              <div style={{ fontSize: 13, color: "#aaa", maxWidth: 300, textAlign: "center", lineHeight: 1.7 }}>
                You've navigated the Fetch, Indirect, and Interrupt cycles — the three pillars of CPU instruction execution!
              </div>
              <button
                onClick={restart}
                style={{
                  background: "transparent",
                  border: "2px solid #00ff9d",
                  color: "#00ff9d",
                  padding: "10px 28px",
                  fontSize: 13,
                  letterSpacing: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                PLAY AGAIN
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Current Task */}
          <div style={{
            border: `1px solid ${cycle.color}55`,
            padding: 12,
            background: "#0d0d1a",
          }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#555", marginBottom: 6 }}>CURRENT OBJECTIVE</div>
            {currentTask && gamePhase === "playing" ? (
              <>
                <div style={{ fontSize: 13, color: cycle.color, fontWeight: 700 }}>
                  {currentTask.text}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.5 }}>
                  {currentTask.hint}
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: "#555" }}>
                  Navigate to:{" "}
                  <span style={{ color: COMP_COLORS[currentTask.target]?.bg ?? "#fff", fontWeight: 700 }}>
                    {currentTask.target}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#555" }}>—</div>
            )}
          </div>

          {/* Task list */}
          <div style={{
            border: "1px solid #1a1a35",
            padding: 12,
            background: "#0d0d1a",
          }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#555", marginBottom: 8 }}>TASK LIST</div>
            {tasks.map((task, i) => {
              const done = completedTasks.includes(task.id);
              const active = i === taskIdx && gamePhase === "playing";
              return (
                <div key={task.id} style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 6,
                  opacity: done ? 0.5 : 1,
                }}>
                  <span style={{ color: done ? "#00ff9d" : (active ? cycle.color : "#333"), fontSize: 12 }}>
                    {done ? "✓" : (active ? "▶" : "○")}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: done ? "#555" : (active ? cycle.color : "#666"),
                    textDecoration: done ? "line-through" : "none",
                    lineHeight: 1.4,
                  }}>
                    {task.text}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Cycle progress */}
          <div style={{
            border: "1px solid #1a1a35",
            padding: 12,
            background: "#0d0d1a",
          }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#555", marginBottom: 8 }}>CYCLE PROGRESS</div>
            {CYCLES.map((c, i) => (
              <div key={c.key} style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 5,
                opacity: i < cycleIdx ? 0.4 : 1,
              }}>
                <span style={{ color: i < cycleIdx ? "#00ff9d" : (i === cycleIdx ? c.color : "#333"), fontSize: 12 }}>
                  {i < cycleIdx ? "✓" : (i === cycleIdx ? "▶" : "○")}
                </span>
                <span style={{ fontSize: 10, color: i === cycleIdx ? c.color : "#555", letterSpacing: 1 }}>
                  {c.label}
                </span>
              </div>
            ))}
          </div>

          {/* Log */}
          <div style={{
            border: "1px solid #1a1a35",
            padding: 12,
            background: "#0d0d1a",
            flexGrow: 1,
          }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#555", marginBottom: 8 }}>EVENT LOG</div>
            {log.length === 0 && (
              <div style={{ fontSize: 11, color: "#333" }}>Navigate to components...</div>
            )}
            {log.map((entry, i) => (
              <div key={i} style={{ fontSize: 11, color: i === 0 ? "#eee" : "#555", marginBottom: 3, lineHeight: 1.3 }}>
                {entry}
              </div>
            ))}
          </div>

          {/* Controls legend */}
          <div style={{
            border: "1px solid #1a1a35",
            padding: 10,
            background: "#0d0d1a",
            fontSize: 10,
            color: "#444",
            lineHeight: 1.7,
          }}>
            <div style={{ letterSpacing: 3, marginBottom: 4, fontSize: 9 }}>CONTROLS</div>
            WASD / Arrow Keys to move<br />
            Navigate to the glowing component
          </div>
        </div>
      </div>

      {/* Mobile D-pad */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginTop: 4 }}>
        <button
          onPointerDown={() => mobileDir("ArrowUp", true)}
          onPointerUp={() => mobileDir("ArrowUp", false)}
          style={dpadStyle}
        >▲</button>
        <div style={{ display: "flex", gap: 4 }}>
          <button onPointerDown={() => mobileDir("ArrowLeft", true)} onPointerUp={() => mobileDir("ArrowLeft", false)} style={dpadStyle}>◀</button>
          <button onPointerDown={() => mobileDir("ArrowDown", true)} onPointerUp={() => mobileDir("ArrowDown", false)} style={dpadStyle}>▼</button>
          <button onPointerDown={() => mobileDir("ArrowRight", true)} onPointerUp={() => mobileDir("ArrowRight", false)} style={dpadStyle}>▶</button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
      `}</style>
    </div>
  );
}

const dpadStyle = {
  width: 48,
  height: 48,
  background: "#0d0d1a",
  border: "1px solid #1a1a35",
  color: "#555",
  fontSize: 18,
  cursor: "pointer",
  fontFamily: "monospace",
  touchAction: "none",
};
