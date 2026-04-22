import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Droplet, Play, RotateCcw, Home, Target, Award, Github, Linkedin, MousePointerClick } from 'lucide-react';

/* --- CORE PHYSICS & TYPES --- */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Level {
  title: string;
  glass: Rect;
  lines: Line[];
}

const CONSTANTS = {
  GRAVITY: 0.15,
  FRICTION: 0.99,
  RESTITUTION: 0.1,
  PARTICLE_RADIUS: 9, // Larger radius for more liquid feel
  TOTAL_LITERS: 100,
  WIN_THRESHOLD: 20, // Extremely easy threshold
  SIM_TIMEOUT: 1200, 
  CANVAS_W: 800,
  CANVAS_H: 1200,
  DROP_ZONE_H: 200,
};

// Math helper: Point to line segment distance
function pDistance(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;

  let xx, yy;
  if (param < 0) {
    xx = x1; yy = y1;
  } else if (param > 1) {
    xx = x2; yy = y2;
  } else {
    xx = x1 + param * C; yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;
  return { dist: Math.sqrt(dx * dx + dy * dy), projX: xx, projY: yy, param };
}

/* --- LEVELS --- */
const LEVELS: Level[] = [
  {
    title: "Sector 1: The Giant Funnel",
    glass: { x: 250, y: 1000, w: 300, h: 180 },
    lines: [
      { x1: 0, y1: 300, x2: 250, y2: 800 },
      { x1: 800, y1: 300, x2: 550, y2: 800 },
    ]
  },
  {
    title: "Sector 2: Smooth Slide",
    glass: { x: 350, y: 1000, w: 350, h: 180 },
    lines: [
      { x1: 0, y1: 200, x2: 500, y2: 600 },
      { x1: 0, y1: 600, x2: 350, y2: 850 },
      { x1: 800, y1: 200, x2: 700, y2: 950 }, // Right safe wall
    ]
  },
  {
    title: "Sector 3: The Drop",
    glass: { x: 150, y: 1050, w: 500, h: 140 },
    lines: [
      { x1: 0, y1: 500, x2: 150, y2: 900 },
      { x1: 800, y1: 500, x2: 650, y2: 900 },
    ]
  }
];

/* --- MAIN COMPONENT --- */
export default function App() {
  const [stage, setStage] = useState<'menu' | 'intro' | 'wait' | 'sim' | 'eval' | 'result'>('menu');
  const [levelIdx, setLevelIdx] = useState(0);
  const [litersInGlass, setLitersInGlass] = useState(0);
  const [didWin, setDidWin] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Physics State (Kept in refs to avoid React re-render looping during 60fps sim)
  const engineRef = useRef({
    particles: [] as Particle[],
    targetDropX: 0,
    spawnCount: 0,
    frameCounter: 0,
    isRunning: false
  });

  const level = LEVELS[levelIdx];

  // Initialize a fresh physics state
  const resetEngine = () => {
    engineRef.current = {
      particles: [],
      targetDropX: 0,
      spawnCount: 0,
      frameCounter: 0,
      isRunning: false
    };
    setLitersInGlass(0);
  };

  // Start Level
  const initLevel = (idx: number) => {
    resetEngine();
    setLevelIdx(idx);
    setStage('intro');
    setTimeout(() => {
      setStage('wait');
    }, 2000);
  };

  // --- PHYSICS LOOP ---
  useEffect(() => {
    if (stage !== 'sim' && stage !== 'wait') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      // Clear Canvas
      ctx.clearRect(0, 0, CONSTANTS.CANVAS_W, CONSTANTS.CANVAS_H);

      // Draw Glass
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1E293B'; // Slate 800
      ctx.beginPath();
      ctx.moveTo(level.glass.x, level.glass.y);
      ctx.lineTo(level.glass.x, level.glass.y + level.glass.h);
      ctx.lineTo(level.glass.x + level.glass.w, level.glass.y + level.glass.h);
      ctx.lineTo(level.glass.x + level.glass.w, level.glass.y);
      ctx.stroke();

      // Glass fill line indicator
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = '#94A3B8';
      const fillLineY = level.glass.y + level.glass.h - (level.glass.h * (CONSTANTS.WIN_THRESHOLD / CONSTANTS.TOTAL_LITERS));
      ctx.beginPath();
      ctx.moveTo(level.glass.x + 10, fillLineY);
      ctx.lineTo(level.glass.x + level.glass.w - 10, fillLineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Obstacle Lines
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#475569'; // Slate 600
      level.lines.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
      });

      // Draw Drop Zone indicator
      if (stage === 'wait') {
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 12]);
        ctx.strokeStyle = '#3B82F680'; // Blue tinted semi-trans
        ctx.fillStyle = '#EFF6FF80';
        ctx.fillRect(0, 0, CONSTANTS.CANVAS_W, CONSTANTS.DROP_ZONE_H);
        ctx.strokeRect(0, 0, CONSTANTS.CANVAS_W, CONSTANTS.DROP_ZONE_H);
        ctx.setLineDash([]);

        ctx.fillStyle = '#1E40AF';
        ctx.font = '500 24px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("TAP HERE TO DROP WATER", CONSTANTS.CANVAS_W/2, CONSTANTS.DROP_ZONE_H / 2);
      }

      // PHYSICS SIMULATION
      const eng = engineRef.current;
      
      if (stage === 'sim') {
        const SUBSTEPS = 4; // High accuracy physics
        const dt = 1 / SUBSTEPS;

        // Spawn particles outside substeps
        if (eng.spawnCount < CONSTANTS.TOTAL_LITERS && eng.frameCounter % 2 === 0) {
          for(let i = 0; i < 4 && eng.spawnCount < CONSTANTS.TOTAL_LITERS; i++) {
             eng.particles.push({
                x: eng.targetDropX + (Math.random() - 0.5) * 40,
                y: 50 + (Math.random() * 20),
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() * 2),
                radius: CONSTANTS.PARTICLE_RADIUS,
                active: true
             });
             eng.spawnCount++;
          }
        }

        const geoms = [...level.lines];
        geoms.push({ x1: level.glass.x, y1: level.glass.y, x2: level.glass.x, y2: level.glass.y + level.glass.h });
        geoms.push({ x1: level.glass.x + level.glass.w, y1: level.glass.y, x2: level.glass.x + level.glass.w, y2: level.glass.y + level.glass.h });
        geoms.push({ x1: level.glass.x, y1: level.glass.y + level.glass.h, x2: level.glass.x + level.glass.w, y2: level.glass.y + level.glass.h });

        let activeCount = 0;
        let settledInGlass = 0;

        for (let step = 0; step < SUBSTEPS; step++) {
            const currentParticles = eng.particles;
            
            // PBD Fluid Density constraint relaxation
            for (let i = 0; i < currentParticles.length; i++) {
               for (let j = i + 1; j < currentParticles.length; j++) {
                  const p1 = currentParticles[i];
                  const p2 = currentParticles[j];
                  if (!p1.active && !p2.active) continue;

                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const dist = Math.sqrt(dx*dx + dy*dy);
                  const minDist = p1.radius + p2.radius;
                  
                  if (dist < minDist && dist > 0.001) {
                     const overlap = minDist - dist;
                     const nx = dx / dist;
                     const ny = dy / dist;

                     // Separate
                     const weight1 = p1.active ? 0.5 : 0;
                     const weight2 = p2.active ? 0.5 : 0;
                     
                     if (p1.active) { p1.x -= nx * overlap * weight1; p1.y -= ny * overlap * weight1; }
                     if (p2.active) { p2.x += nx * overlap * weight2; p2.y += ny * overlap * weight2; }

                     // Artificial Viscosity
                     if (p1.active && p2.active) {
                         const vxDiff = p2.vx - p1.vx;
                         const vyDiff = p2.vy - p1.vy;
                         p1.vx += vxDiff * 0.015;
                         p1.vy += vyDiff * 0.015;
                         p2.vx -= vxDiff * 0.015;
                         p2.vy -= vyDiff * 0.015;
                     }
                  }
               }
            }

            activeCount = 0;
            settledInGlass = 0;

            for (let p of currentParticles) {
              if (!p.active) {
                 if (p.x > level.glass.x && p.x < level.glass.x + level.glass.w && p.y > level.glass.y) settledInGlass++;
                 continue; // Fixed
              }

              // Euler integration with friction & gravity (sub-stepped)
              p.vy += CONSTANTS.GRAVITY;
              p.vx *= CONSTANTS.FRICTION;
              p.vy *= CONSTANTS.FRICTION;
              p.x += p.vx * dt;
              p.y += p.vy * dt;

              // Force absolute container boundaries to prevent particles from flying out of the app
              if (p.x < p.radius) { p.x = p.radius; p.vx *= -0.5; }
              if (p.x > CONSTANTS.CANVAS_W - p.radius) { p.x = CONSTANTS.CANVAS_W - p.radius; p.vx *= -0.5; }

              // Geometry Collisions
              for (let g of geoms) {
                 const { dist, projX, projY } = pDistance(p.x, p.y, g.x1, g.y1, g.x2, g.y2);
                 const collideRadius = p.radius + 8; // Slight buffer padding
                 if (dist < collideRadius) {
                    const dx = p.x - projX;
                    const dy = p.y - projY;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    if (len > 0.001) {
                       const nx = dx / len;
                       const ny = dy / len;
                       // Resolve penetration
                       p.x = projX + nx * collideRadius;
                       p.y = projY + ny * collideRadius;
                       
                       // Resolve velocity (reflect vector)
                       const dot = p.vx * nx + p.vy * ny;
                       p.vx = (p.vx - (1 + CONSTANTS.RESTITUTION) * dot * nx);
                       p.vy = (p.vy - (1 + CONSTANTS.RESTITUTION) * dot * ny);
                    }
                 }
              }

              if (p.y > CONSTANTS.CANVAS_H + 50) {
                 p.active = false; 
              } else {
                 if (p.y > level.glass.y + 10 && p.x > level.glass.x && p.x < level.glass.x + level.glass.w) {
                    if (Math.abs(p.vx) < 0.2 && Math.abs(p.vy) < 0.2) p.active = false; 
                 }
                 if (p.active) activeCount++;
              }
            }
        } // End Substeps
        
        eng.frameCounter++;
        if (eng.frameCounter > CONSTANTS.SIM_TIMEOUT || (eng.spawnCount === CONSTANTS.TOTAL_LITERS && activeCount === 0)) {
           setLitersInGlass(settledInGlass);
           setDidWin(settledInGlass >= CONSTANTS.WIN_THRESHOLD);
           setStage('eval');
        }
      }

      // 3. Render Particles
      // Liquid rendering style
      ctx.globalAlpha = 0.8; 
      ctx.fillStyle = '#0CA5E9'; // Deep cyan core
      engineRef.current.particles.forEach(p => {
         ctx.beginPath();
         ctx.arc(p.x, p.y, p.radius * 1.2, 0, Math.PI * 2); 
         ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      if (stage === 'sim' || stage === 'wait') {
         animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [stage, level]);


  // Pointer Action (Dropping Water)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (stage !== 'wait') return;
    
    // Calculate click pos relative to conceptual 800x1200 canvas
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Must be in drop zone
    if (y <= CONSTANTS.DROP_ZONE_H) {
      engineRef.current.targetDropX = x;
      setStage('sim');
    }
  };

  // UI Flow Logic
  useEffect(() => {
    if (stage === 'eval') {
       setTimeout(() => {
          setStage('result');
       }, 1000);
    }
  }, [stage]);

  const handleNextLevel = () => {
    if (levelIdx + 1 < LEVELS.length) {
      initLevel(levelIdx + 1);
    } else {
      setStage('menu'); // Technically won the game! Could add a victory screen.
    }
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col font-sans select-none overflow-hidden relative">
      
      {/* Header Overlay */}
      <header className="absolute top-0 left-0 w-full z-20 pointer-events-auto p-4 flex justify-between items-center sm:px-6 glass-panel border-b border-slate-200">
         <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setStage('menu')}>
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
               <Droplet strokeWidth={2.5} size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Aqua<span className="text-blue-500">Flow</span></h1>
         </div>
         <div className="flex items-center gap-4">
            <span className="hidden sm:flex text-[10px] sm:text-xs font-bold tracking-widest uppercase text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              Open Source Format
            </span>
            {(stage !== 'menu' && stage !== 'result') && (
               <button 
                  onClick={() => setStage('menu')}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm border border-slate-200 text-slate-500 hover:text-blue-500 hover:scale-105 transition-all"
               >
                  <Home size={18} />
               </button>
            )}
         </div>
      </header>

      {/* Main Canvas Area */}
      <main className="flex-1 w-full bg-[#F1F5F9] flex items-center justify-center relative overflow-hidden">
         {/* The Physics Canvas */}
         <canvas
            ref={canvasRef}
            width={CONSTANTS.CANVAS_W}
            height={CONSTANTS.CANVAS_H}
            onClick={handleCanvasClick}
            onTouchStart={handleCanvasClick}
            className="w-full h-full max-w-lg object-contain bg-white shadow-2xl touch-none"
         />

         {/* GAME STATE UI OVERLAYS */}
         <AnimatePresence mode='wait'>
            
            {/* Main Menu */}
            {stage === 'menu' && (
              <motion.div 
               key="menu"
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/90 backdrop-blur-sm z-10 p-6"
              >
                 <div className="glass-panel p-10 rounded-3xl w-full max-w-sm flex flex-col items-center border border-white relative overflow-hidden shadow-2xl">
                    <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center mb-6">
                       <Droplet size={32} fill="currentColor" strokeWidth={1} />
                    </div>
                    <h2 className="text-4xl font-extrabold tracking-tight text-slate-800 mb-2">AquaFlow</h2>
                    <p className="text-sm font-medium text-slate-500 mb-8 uppercase tracking-widest text-center">
                       Liquid Physics Puzzle <br/> <span className="text-xs opacity-70">By Ram Bapat</span>
                    </p>

                    <div className="bg-slate-50 w-full p-4 rounded-xl mb-8 border border-slate-100 text-sm font-medium text-slate-600 space-y-3">
                       <div className="flex items-center gap-3"><MousePointerClick className="text-blue-500" size={18}/> <span>1. Tap top zone to drop water</span></div>
                       <div className="flex items-center gap-3"><Droplet className="text-blue-500" size={18}/> <span>2. Gravity handles the rest</span></div>
                       <div className="flex items-center gap-3"><Target className="text-blue-500" size={18}/> <span>3. Capture {CONSTANTS.WIN_THRESHOLD}L to pass</span></div>
                    </div>

                    <button 
                       onClick={() => initLevel(0)}
                       className="w-full py-4 rounded-xl bg-blue-500 text-white font-bold tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 active:scale-95"
                    >
                       <Play fill="currentColor" size={18} /> Initiate Run
                    </button>
                 </div>
              </motion.div>
            )}

            {/* Level Intro */}
            {stage === 'intro' && (
              <motion.div
               key="intro"
               initial={{ opacity: 0, scale: 0.8 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, y: -20 }}
               className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-md z-10"
              >
                 <h2 className="text-5xl font-black tracking-tighter text-slate-800 drop-shadow-sm">{level.title}</h2>
                 <p className="mt-4 text-blue-600 font-bold uppercase tracking-widest text-sm">Target: {CONSTANTS.WIN_THRESHOLD}L Captured</p>
              </motion.div>
            )}

            {/* In-Game HUD overlay for Drop Phase */}
            {stage === 'wait' && (
              <motion.div
                 initial={{ opacity: 0, y: -20 }}
                 animate={{ opacity: 1, y: 0 }}
                 className="absolute top-24 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
              >
                 <div className="hud-pill px-6 py-3 rounded-full flex items-center gap-3 text-slate-800 font-bold tracking-widest uppercase text-xs">
                    <MousePointerClick className="text-blue-500 animate-bounce" size={18} />
                    Tap the Drop Zone
                 </div>
              </motion.div>
            )}

            {/* Processing Eval overlay */}
            {stage === 'eval' && (
              <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="absolute inset-0 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm z-10"
              >
                 <div className="hud-pill px-8 py-4 rounded-full flex items-center gap-3 text-slate-800 font-bold tracking-widest uppercase shadow-xl animate-pulse">
                    Assessing Liquid Volume...
                 </div>
              </motion.div>
            )}

            {/* Results Screen */}
            {stage === 'result' && (
               <motion.div
                key="result"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-md z-10 p-6"
               >
                  <div className="glass-panel p-10 rounded-3xl w-full max-w-sm flex flex-col items-center border shadow-2xl relative overflow-hidden bg-white/95">
                     
                     <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-xl ${didWin ? 'bg-green-100 text-green-600 shadow-green-500/20' : 'bg-rose-100 text-rose-600 shadow-rose-500/20'}`}>
                        {didWin ? <Award size={40} /> : <RotateCcw size={40} />}
                     </div>

                     <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2">
                        {didWin ? "Sector Cleared" : "Insufficient Yield"}
                     </h2>
                     <p className="text-slate-500 text-sm font-medium mb-8 text-center px-4">
                        {didWin ? "Optimal fluid displacement achieved." : "The container threshold was not met."}
                     </p>

                     <div className="w-full bg-slate-50 rounded-2xl border border-slate-200 p-6 mb-8">
                        <div className="flex justify-between items-center mb-4">
                           <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Captured Volume</span>
                           <span className={`text-2xl font-black ${didWin ? 'text-green-600' : 'text-rose-600'}`}>{litersInGlass} L</span>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                           <div 
                              className={`h-full rounded-full transition-all duration-1000 ${didWin ? 'bg-green-500' : 'bg-rose-500'}`}
                              style={{ width: `${Math.min(100, (litersInGlass / CONSTANTS.WIN_THRESHOLD) * 100)}%` }}
                           />
                        </div>
                        <div className="flex justify-between mt-2">
                           <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">0 L</span>
                           <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Target: {CONSTANTS.WIN_THRESHOLD} L</span>
                        </div>
                     </div>

                     <div className="w-full flex flex-col gap-3">
                        {didWin ? (
                           <>
                             {levelIdx + 1 < LEVELS.length ? (
                               <button 
                                 onClick={handleNextLevel}
                                 className="w-full py-4 rounded-xl bg-slate-800 text-white font-bold tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-slate-900 transition-all shadow-lg active:scale-95"
                               >
                                 Next Sector <Play fill="currentColor" size={16} />
                               </button>
                             ) : (
                               <button 
                                 onClick={() => setStage('menu')}
                                 className="w-full py-4 rounded-xl bg-blue-500 text-white font-bold tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-blue-600 transition-all shadow-lg active:scale-95"
                               >
                                 Campaign Complete <Award size={16} />
                               </button>
                             )}
                           </>
                        ) : (
                           <button 
                              onClick={() => initLevel(levelIdx)}
                              className="w-full py-4 rounded-xl bg-slate-800 text-white font-bold tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-slate-900 transition-all shadow-lg active:scale-95"
                           >
                              <RotateCcw size={16} /> Retry Sector
                           </button>
                        )}
                        <button 
                           onClick={() => setStage('menu')}
                           className="w-full py-3 rounded-xl bg-transparent border border-slate-200 text-slate-500 font-bold tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-slate-50 transition-all active:scale-95"
                        >
                           <Home size={16} /> Main Menu
                        </button>
                     </div>
                  </div>
               </motion.div>
            )}
         </AnimatePresence>
      </main>

      {/* Footer Area */}
      <footer className="w-full p-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center z-20 pointer-events-auto bg-white border-t border-slate-200 text-slate-500">
         <div className="flex items-center gap-3 mb-3 sm:mb-0">
            <span className="text-[10px] sm:text-xs font-bold tracking-widest uppercase">Developed By <span className="text-blue-500 border-b border-blue-500/30 pb-0.5">Ram Bapat</span></span>
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest uppercase opacity-70">Open Source</span>
         </div>
         <div className="flex items-center gap-6">
            <a href="https://github.com/Barrsum/AquaFlow-Water-Game.git" target="_blank" rel="noopener noreferrer" className="hover:text-slate-800 transition-colors">
              <Github size={18} />
            </a>
            <a href="https://www.linkedin.com/in/ram-bapat-barrsum-diamos" target="_blank" rel="noopener noreferrer" className="hover:text-[#0A66C2] transition-colors">
              <Linkedin size={18} />
            </a>
         </div>
      </footer>
    </div>
  );
}
