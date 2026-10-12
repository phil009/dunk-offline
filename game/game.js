/* =====================================================================
   DUNK SHOT  -  a tiny physics game in plain JavaScript + <canvas>

   HOW TO READ THIS FILE
   The code is split into numbered sections. Read them in order:

     1. CONFIG        every number you can tweak to change the "feel"
     2. STATE         the one object that holds the whole game
     3. HELPERS       small utility functions
     4. HOOPS         creating hoops and where the ball rests in them
     5. INPUT         drag-to-aim with the mouse or finger
     6. PHYSICS       gravity, walls, rim collisions, scoring
     7. UPDATE        the per-tick logic that ties it together
     8. RENDER        drawing everything onto the canvas
     9. GAME LOOP     the fixed timestep loop that drives it all
    10. UI            title / game-over panel and best score

   THE BIG IDEAS (if you only remember four things)
   - Every frame we do:   velocity += gravity * dt;   position += velocity * dt.
     That alone produces the natural curved (parabola) flight.
   - The rim is just TWO small invisible circles, one at each end of the
     hoop. Ball-vs-circle collisions are easy and feel great.
   - You score when the ball's centre crosses the hoop's rim line while
     moving DOWN and between the two rim circles.
   - The "camera" is just a number (camY). We shift everything we draw
     up or down by it, so the world can be as tall as we like.
   ===================================================================== */

(() => {
  'use strict';

  /* ===================================================================
     1. CONFIG  -  tweak these to change how the game feels
     =================================================================== */

  // The logical size of the game world. We always think in these units.
  // The canvas is later scaled to fit the real screen (see resizeCanvas).
  const W = 400;
  const H = 700;

  // Physics units are "pixels" and "seconds".
  const GRAVITY     = 1500;  // px/s^2, pulls the ball down. Higher = heavier, snappier arcs.
  const BALL_R      = 16;    // ball radius in px
  const RIM_R       = 5;     // radius of the little circle at each end of a hoop's rim
  const WALL_BOUNCE = 0.75;  // 1 = perfectly bouncy, 0 = dead. Wall hits keep 75% of speed.
  const RIM_BOUNCE  = 0.55;  // rims are a bit "deader" than walls, feels more like metal on a ball

  // Aiming
  const MAX_PULL = 140;      // longest drag (in px) that counts; further drags are capped
  const MIN_PULL = 14;       // shorter drags are ignored (stops accidental taps firing)
  const POWER    = 10;      // launch speed = pull length * POWER. 110 * 9.5 = ~1045 px/s max.

  // Simulation step. We run physics in tiny fixed slices of 1/120 s.
  // Small fixed steps make collisions reliable (the ball can't "tunnel" through a rim)
  // and make the game behave the same on 60 Hz and 144 Hz screens.
  const STEP = 1 / 120;

  // Trajectory preview: draw PREVIEW_DOTS dots, one every PREVIEW_EVERY physics steps.
  const PREVIEW_DOTS  = 18;
  const PREVIEW_EVERY = 5;

  // Hoop shape
  const NET_DEPTH   = 40;    // how far the net hangs below the rim
  const REST_OFFSET = 12;    // the ball sits this many px BELOW the rim line when parked in a hoop

  // Colors the canvas uses (kept in sync with the CSS variables at the top)
  const PALETTE = {
    courtTop:    '#14333c',
    courtBottom: '#0b1c22',
    chalk:       '#e9e4d6',
    ball:        '#f08a24',
    ballSeam:    '#6b3208',
    rim:         '#e5482f',
    net:         '#f2ede0',
    gold:        '#f3c13a',
  };

  /* ===================================================================
     2. STATE  -  everything that changes while you play lives here
     =================================================================== */

  const game = {
    // mode controls which rules apply this tick:
    //   'title'    waiting for the player to press Play
    //   'aiming'   ball is parked in a hoop, player can drag
    //   'flying'   ball is in the air, physics running
    //   'settling' ball just scored, easing into the new hoop
    //   'over'     ball fell off the bottom
    mode: 'title',

    score: 0,
    best: 0,
    streak: 0,         // how many swishes in a row (a swish = scored without touching rim)

    time: 0,           // seconds since start, used for the net wobble animation
    camY: 0,           // world y of the TOP edge of the screen (see camera notes in RENDER)

    hoops: [],         // every hoop that still matters (current, target, and a few below)
    current: null,     // the hoop the ball is sitting in / launched from
    target: null,      // the next hoop up, the one we are trying to score in

    // The ball. x,y = centre position. vx,vy = velocity in px/s. rot = spin angle.
    ball: { x: 0, y: 0, vx: 0, vy: 0, rot: 0 },

    touched: false,        // did this shot touch a rim? (if not, it's a "swish")
    trickShot: false,          // how many times did the shot come off the walls?
    launchIgnore: null,    // the hoop we just left; we ignore its rim until we're clear of it
    drag: null,            // while dragging: { sx, sy, x, y } = start point and current point
    popups: [],            // floating "+2 Swish" texts
  };

  /* ===================================================================
     3. HELPERS
     =================================================================== */

  // Random number between a and b.
  const rand = (a, b) => a + Math.random() * (b - a);

  // Where the ball sits when parked inside hoop h.
  const restPos = (h) => ({ x: h.x, y: h.y + REST_OFFSET });

  /* ===================================================================
     4. HOOPS
     =================================================================== */

  // A hoop is just a position plus a width. (x, y) is the CENTRE of the rim line.
  // halfW is half the distance between the two rim circles.
  function makeHoop(x, y) {
    return {
      x, y,
      // Hoops get narrower as your score climbs, never below 32 px, so the game ramps up.
      halfW: Math.max(32, 48 - game.score * 0.5),
      squish: 0,           // 1 right after a basket, decays to 0. Drives the net animation.
    };
  }

  // Create the next hoop above `prev`, at a random reachable spot.
  function spawnNext(prev) {
    const y = prev.y - rand(170, 240);        // always higher up (smaller y = higher on screen)
    let x;
    do {
      x = rand(70, 330);                       // stay away from the walls
    } while (Math.abs(x - prev.x) < 70);       // and don't stack straight above the last one
    const h = makeHoop(x, y);
    game.hoops.push(h);
    return h;
  }

  // The camera tries to keep the current hoop about 70% of the way down the screen.
  const cameraTarget = () => game.current.y - H * 0.7;

  // Start (or restart) a run.
  function resetGame() {
    game.score = 0;
    game.streak = 0;
    game.time = 0;
    game.popups = [];
    game.drag = null;
    game.touched = false;
    game.trickShot = false;
    game.launchIgnore = null;

    const first = makeHoop(W / 2, 560);
    game.hoops = [first];
    game.current = first;
    game.target = spawnNext(first);

    const r = restPos(first);
    game.ball = { x: r.x, y: r.y, vx: 0, vy: 0, rot: 0 };

    game.camY = cameraTarget();    // snap camera instantly, no slide on a fresh run
    game.mode = 'aiming';
    setScoreText();
  }

  /* ===================================================================
     5. INPUT  -  drag anywhere to aim, release to shoot (slingshot style)
     =================================================================== */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Convert a pointer event (screen pixels) into our logical 400x700 space.
  // getBoundingClientRect gives the canvas's size on screen; we scale by W / that width.
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height),
    };
  }

  // The pull vector. The ball launches in the direction FROM the pointer TO where the
  // drag started. So dragging down-left shoots up-right, exactly like a slingshot.
  function getPull() {
    const d = game.drag;
    if (!d) return null;

    let px = d.sx - d.x;               // pull direction x
    let py = d.sy - d.y;               // pull direction y (negative = pointing up)
    let len = Math.hypot(px, py);      // pull length = Pythagoras

    // Cap the length so a huge drag can't make the ball absurdly fast.
    if (len > MAX_PULL) {
      const k = MAX_PULL / len;        // scale factor to shrink the vector to MAX_PULL
      px *= k; py *= k; len = MAX_PULL;
    }

    // Valid = long enough AND pointing at least a bit upward (shooting down is pointless).
    return { px, py, len, valid: len >= MIN_PULL && py < 0 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (game.mode !== 'aiming') return;
    // "Capture" keeps sending us move/up events even if the finger leaves the canvas.
    canvas.setPointerCapture(e.pointerId);
    const p = toLogical(e);
    game.drag = { sx: p.x, sy: p.y, x: p.x, y: p.y };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!game.drag) return;
    const p = toLogical(e);
    game.drag.x = p.x;
    game.drag.y = p.y;
  });

  function endDrag() {
    if (!game.drag) return;
    const pull = getPull();
    game.drag = null;
    if (pull && pull.valid) launch(pull);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { game.drag = null; });

  // Turn the pull vector into a velocity and let go.
  function launch(pull) {
    const b = game.ball;
    b.vx = pull.px * POWER;
    b.vy = pull.py * POWER;            // py is negative, so vy is negative = moving UP
    game.touched = false;              // fresh shot, nothing touched yet
    game.trickShot = false;            // reset trickshot
    game.launchIgnore = game.current;  // don't collide with the rim we're leaving
    game.mode = 'flying';
  }

  /* ===================================================================
     6. PHYSICS
     =================================================================== */

  // Collide the ball with ONE rim circle centred at (cx, cy).
  // This is the heart of the "natural" rim bounces.
  function collideRim(cx, cy) {
    const b = game.ball;

    // Vector from the rim circle to the ball centre.
    let dx = b.x - cx;
    let dy = b.y - cy;
    let dist = Math.hypot(dx, dy);

    // Two circles touch when the distance between centres < sum of radii.
    const minDist = BALL_R + RIM_R;
    if (dist >= minDist) return;              // not touching, nothing to do

    if (dist === 0) { dx = 0; dy = -1; dist = 1; }   // exact overlap: invent an "up" direction

    // The collision NORMAL: a unit-length arrow pointing from the rim toward the ball.
    const nx = dx / dist;
    const ny = dy / dist;

    // 1) Push the ball out so the circles no longer overlap.
    b.x = cx + nx * minDist;
    b.y = cy + ny * minDist;

    // 2) Reflect velocity. First measure how fast the ball moves INTO the rim:
    //    the dot product of velocity and normal. Negative = moving toward the rim.
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      // Remove the into-the-rim part and bounce it back, scaled by RIM_BOUNCE.
      // (1 + bounce) is the classic reflection formula with energy loss.
      b.vx -= (1 + RIM_BOUNCE) * vn * nx;
      b.vy -= (1 + RIM_BOUNCE) * vn * ny;
      game.touched = true;                    // no longer a clean swish
    }
  }

  // Advance the ball by one small physics slice `dt` (seconds).
  function stepFlight(dt) {
    const b = game.ball;
    const prevY = b.y;                        // remember where we were, needed for scoring

    // Gravity changes velocity, velocity changes position. That's all of projectile motion.
    b.vy += GRAVITY * dt;
    b.x  += b.vx * dt;
    b.y  += b.vy * dt;

    // Spin the ball visually in the direction it rolls. (arc length = angle * radius)
    b.rot += (b.vx * dt) / BALL_R;

    // ---- Walls: flip horizontal velocity and lose a little energy ----
    if (b.x < BALL_R) {
      b.x = BALL_R;                           // put the ball back inside
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;    // abs() guarantees it now moves right
      game.trickShot = true;
    } else if (b.x > W - BALL_R) {
      b.x = W - BALL_R;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;   // guarantees it now moves left
      game.trickShot = true;
    }

    // ---- Rims: two circles per hoop ----
    for (const h of game.hoops) {
      if (h === game.launchIgnore) continue;  // skip the hoop we just left
      collideRim(h.x - h.halfW, h.y);         // left rim circle
      collideRim(h.x + h.halfW, h.y);         // right rim circle
    }

    // Once the ball has risen clearly above the hoop we launched from, start
    // treating that hoop as solid again (so you can't fall back through it for free).
    const li = game.launchIgnore;
    if (li && b.y < li.y - (BALL_R + RIM_R)) game.launchIgnore = null;

    // ---- Scoring ----
    // A basket = ball centre crosses the rim line (t.y) going DOWN, between the rims.
    //   b.vy > 0        moving downward (so entering from below never counts)
    //   prevY < t.y     last step we were above the line...
    //   b.y >= t.y      ...and now we are on or below it
    //   |b.x - t.x|     horizontally inside the rim opening
    const t = game.target;
    if (b.vy > 0 && prevY < t.y && b.y >= t.y && Math.abs(b.x - t.x) < t.halfW) {
      scoreBasket();
      return;
    }

    // ---- Miss: ball fell below the bottom of the screen ----
    if (b.y - game.camY > H + BALL_R * 2) gameOver();
  }

  function scoreBasket() {
    const h         = game.target;
    const cleanShot = !game.touched;                // never touched a rim
    const trickShot = cleanShot && game.trickShot;  // clean but came off a wall
    const swish     = cleanShot && game.trickShot;  // clean, no walls either
    let points = 1;
    if (cleanShot) {
      game.streak += 1;
      points = 1 + game.streak;               // 1st swish = 2, 2nd in a row = 3, ...
      if (trickShot) points *= 2;             // bank shots are worth double     
    } 
    else{
      game.streak = 0;
    }
    game.score += points;
    setScoreText();

    // Floating text above the hoop (world coordinates, so it scrolls with the world)
    game.popups.push({
      text: swish ? `Swish +${points}` : `+${points}`,
      x: h.x, y: h.y - 30, life: 1,
      color: swish ? PALETTE.gold : PALETTE.chalk,
    });

    h.squish = 1;                             // kick off the net wobble

    // Promote: the hoop we just scored in becomes the new "current",
    // and we spawn a fresh target above it.
    game.current = h;
    game.target = spawnNext(h);
    game.launchIgnore = null;

    // Stop the ball dead; the settle animation will glide it to the resting spot.
    game.ball.vx = 0;
    game.ball.vy = 0;
    game.mode = 'settling';

    // Housekeeping: forget hoops that are far below the screen.
    game.hoops = game.hoops.filter(
      (hp) => hp === game.current || hp === game.target || hp.y < game.camY + H + 150
    );

    if (game.score > game.best) {
      game.best = game.score;
      saveBest();
    }
  }

  function gameOver() {
    game.mode = 'over';
    game.streak = 0;
    showOverlay('over');
  }

  /* ===================================================================
     7. UPDATE  -  one fixed-size tick of game logic
     =================================================================== */

  function update(dt) {
    game.time += dt;

    // Camera: slide smoothly toward its target. This is "exponential smoothing":
    // every tick we close a fixed FRACTION of the remaining gap, which feels natural.
    // Math.exp(-dt * speed) makes the result independent of tick rate.
    if (game.current && game.mode !== 'title') {
      const k = 1 - Math.exp(-dt * 4);
      game.camY += (cameraTarget() - game.camY) * k;
    }

    // Let net wobble fade out.
    for (const h of game.hoops) h.squish *= Math.exp(-dt * 5);

    // Float popups upward and fade them.
    for (const p of game.popups) { p.y -= 40 * dt; p.life -= dt * 0.9; }
    game.popups = game.popups.filter((p) => p.life > 0);

    const b = game.ball;

    if (game.mode === 'aiming') {
      // Park the ball in the hoop. While dragging, pull it back a little (purely cosmetic
      // "stretch" so the shot feels loaded). Preview and launch both start from here.
      const rest = restPos(game.current);
      const pull = getPull();
      if (pull && pull.valid) {
        b.x = rest.x - pull.px * 0.15;
        b.y = rest.y - pull.py * 0.15;
      } else {
        b.x = rest.x;
        b.y = rest.y;
      }
    } else if (game.mode === 'flying') {
      stepFlight(dt);
    } else if (game.mode === 'settling') {
      // Glide the ball to the new hoop's resting spot.
      const rest = restPos(game.current);
      const k = 1 - Math.exp(-dt * 16);
      b.x += (rest.x - b.x) * k;
      b.y += (rest.y - b.y) * k;
      if (Math.hypot(rest.x - b.x, rest.y - b.y) < 0.5) {
        b.x = rest.x; b.y = rest.y;
        game.mode = 'aiming';                 // ready for the next shot
      }
    }
  }

  /* ===================================================================
     8. RENDER  -  draw the current state
     -------------------------------------------------------------------
     CAMERA NOTE: world coordinates (hoop.y, ball.y) never change when the
     camera moves. To draw, we call ctx.translate(0, -camY), which shifts
     everything up by camY pixels. Anything with world y == camY lands at
     the top edge of the screen.
     =================================================================== */

  let courtGradient = null;

  function render() {
    // Scale so that our 400x700 logical space fills the real canvas.
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    // ---- Background (screen space, not affected by camera) ----
    if (!courtGradient) {
      courtGradient = ctx.createLinearGradient(0, 0, 0, H);
      courtGradient.addColorStop(0, PALETTE.courtTop);
      courtGradient.addColorStop(1, PALETTE.courtBottom);
    }
    ctx.fillStyle = courtGradient;
    ctx.fillRect(0, 0, W, H);

    // Faint dashed chalk lines every 140 world-px. They scroll with the camera,
    // which is what tells your eyes the world is moving up.
    ctx.strokeStyle = 'rgba(233,228,214,0.07)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    const spacing = 140;
    const first = Math.floor(game.camY / spacing) * spacing;
    for (let wy = first; wy < game.camY + H + spacing; wy += spacing) {
      const screenY = wy - game.camY;
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(W, screenY);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Side walls: a thin bright strip so you can see where the ball will bounce.
    ctx.fillStyle = 'rgba(233,228,214,0.16)';
    ctx.fillRect(0, 0, 4, H);
    ctx.fillRect(W - 4, 0, 4, H);

    // ---- World drawing (camera applied) ----
    ctx.save();
    ctx.translate(0, -game.camY);

    // Draw order matters: later things appear in FRONT of earlier things.
    //   1) nets + back half of rim   (behind the ball)
    //   2) trajectory preview
    //   3) the ball
    //   4) front half of rim + rim end caps (in front of the ball, so the ball looks "in" the hoop)
    //   5) popups
    for (const h of game.hoops) { drawNet(h); drawRimBack(h); }
    drawPreview();
    drawBall();
    for (const h of game.hoops) drawRimFront(h);
    drawPopups();

    ctx.restore();
  }

  // The net: five strands from the rim down to a narrower bottom, plus three cross-strands.
  // `squish` makes it stretch and wobble after a basket.
  function drawNet(h) {
    const topHalf = h.halfW;
    const botHalf = h.halfW * 0.62 * (1 + h.squish * 0.3);   // net widens when squished

    // Extra stretch while the player is pulling back on this hoop's ball.
    const pull = (h === game.current) ? getPull() : null;
    const stretch = pull && pull.valid ? (pull.len / MAX_PULL) * 10 : 0;

    const depth = NET_DEPTH + h.squish * 14 + stretch;
    const wob = Math.sin(game.time * 28) * h.squish * 4;     // sideways sway

    ctx.strokeStyle = PALETTE.net;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;

    // Vertical-ish strands
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;                                        // 0..1 across the hoop
      const xTop = h.x - topHalf + 2 * topHalf * t;
      const xBot = h.x - botHalf + 2 * botHalf * t + wob;
      ctx.beginPath();
      ctx.moveTo(xTop, h.y);
      ctx.lineTo(xBot, h.y + depth);
      ctx.stroke();
    }

    // Horizontal rings: interpolate between the top edge and bottom edge.
    for (let r = 1; r <= 3; r++) {
      const f = r / 4;                                        // how far down the net (0..1)
      const left  = (h.x - topHalf) + ((h.x - botHalf + wob) - (h.x - topHalf)) * f;
      const right = (h.x + topHalf) + ((h.x + botHalf + wob) - (h.x + topHalf)) * f;
      ctx.beginPath();
      ctx.moveTo(left, h.y + depth * f);
      ctx.lineTo(right, h.y + depth * f);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The rim is drawn as an ellipse (a circle seen from slightly above).
  // Canvas angles: 0..PI is the LOWER half (the part nearest the viewer),
  // PI..2PI is the UPPER half (the far side). We draw the far side behind the ball
  // and the near side in front of it.
  function drawRimBack(h) {
    ctx.strokeStyle = PALETTE.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, h.halfW, 7, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  function drawRimFront(h) {
    ctx.strokeStyle = PALETTE.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, h.halfW, 7, 0, 0, Math.PI);
    ctx.stroke();

    // The two end caps are the ACTUAL collision circles from collideRim().
    // Drawing them makes the physics visible, so bounces never look "unfair".
    ctx.fillStyle = PALETTE.rim;
    ctx.beginPath();
    ctx.arc(h.x - h.halfW, h.y, RIM_R, 0, Math.PI * 2);
    ctx.arc(h.x + h.halfW, h.y, RIM_R, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBall() {
    const b = game.ball;
    ctx.save();
    ctx.translate(b.x, b.y);        // move the origin to the ball's centre...
    ctx.rotate(b.rot);              // ...and spin the drawing, so seams roll with the ball

    // Clip to the ball's circle so seam curves never poke outside it.
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.ball;
    ctx.fill();
    ctx.clip();

    // Seams: a cross plus two curves bulging toward the middle, like a real basketball.
    ctx.strokeStyle = PALETTE.ballSeam;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-BALL_R, 0); ctx.lineTo(BALL_R, 0);
    ctx.moveTo(0, -BALL_R); ctx.lineTo(0, BALL_R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-BALL_R * 1.35, 0, BALL_R, 0, Math.PI * 2);       // left curve
    ctx.stroke();
    ctx.beginPath();
    ctx.arc( BALL_R * 1.35, 0, BALL_R, 0, Math.PI * 2);       // right curve
    ctx.stroke();

    ctx.restore();

    // Soft highlight (not rotated, so light always seems to come from the top-left).
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(b.x - 5, b.y - 6, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trajectory preview: run the SAME physics forward in a throwaway copy of the ball
  // and drop a dot every few steps. Because it uses the same gravity and the same
  // step size, the dots match the real flight (except it ignores rim hits).
  function drawPreview() {
    const pull = getPull();
    if (game.mode !== 'aiming' || !pull || !pull.valid) return;

    let x = game.ball.x;
    let y = game.ball.y;
    let vx = pull.px * POWER;
    let vy = pull.py * POWER;

    ctx.fillStyle = PALETTE.chalk;
    for (let i = 0; i < PREVIEW_DOTS; i++) {
      for (let s = 0; s < PREVIEW_EVERY; s++) {
        vy += GRAVITY * STEP;
        x += vx * STEP;
        y += vy * STEP;
        if (x < BALL_R)     { x = BALL_R;     vx =  Math.abs(vx) * WALL_BOUNCE; }
        if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx) * WALL_BOUNCE; }
      }
      const fade = 1 - i / PREVIEW_DOTS;           // later dots are smaller and fainter
      ctx.globalAlpha = 0.25 + 0.7 * fade;
      ctx.beginPath();
      ctx.arc(x, y, 2 + 2.5 * fade, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    ctx.font = '900 28px "Big Shoulders Display", Impact, sans-serif';
    for (const p of game.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ===================================================================
     9. GAME LOOP  -  fixed timestep with an accumulator
     -------------------------------------------------------------------
     Screens refresh at different speeds. If we ran physics once per frame,
     a 144 Hz monitor would run the game faster than a 60 Hz one. Instead:
       - measure how much real time passed since the last frame
       - add it to a "bank" (the accumulator)
       - spend the bank in fixed STEP-sized chunks, running update() for each
       - draw once
     =================================================================== */

  let lastTime = performance.now();
  let accumulator = 0;

  function frame(now) {
    // Cap frame time at 50 ms. If the tab was in the background for a minute,
    // we don't want to simulate a minute of physics in one go.
    const frameTime = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    accumulator += frameTime;

    while (accumulator >= STEP) {
      update(STEP);
      accumulator -= STEP;
    }

    render();
    requestAnimationFrame(frame);
  }

  // Keep the canvas's real pixel size matched to its on-screen size,
  // multiplied by devicePixelRatio so it stays crisp on high-density phones.
  const stage = document.getElementById('stage');
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.max(1, Math.round(stage.clientWidth  * dpr));
    canvas.height = Math.max(1, Math.round(stage.clientHeight * dpr));
  }
  new ResizeObserver(resizeCanvas).observe(stage);
  resizeCanvas();

  /* ===================================================================
     10. UI  -  score text, overlay panel, saved best score
     =================================================================== */

  const scoreEl   = document.getElementById('score');
  const overlay   = document.getElementById('overlay');
  const ovTitle   = document.getElementById('ovTitle');
  const ovStats   = document.getElementById('ovStats');
  const ovHint    = document.getElementById('ovHint');
  const playBtn   = document.getElementById('playBtn');

  function setScoreText() { scoreEl.textContent = game.score; }

  // localStorage can throw (private mode, blocked storage), so always try/catch it
  // and make sure the game still works if it fails.
  function loadBest() {
    try { game.best = parseInt(localStorage.getItem('dunkshot-best') || '0', 10) || 0; }
    catch (e) { game.best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem('dunkshot-best', String(game.best)); } catch (e) { /* ignore */ }
  }

  function showOverlay(kind) {
    if (kind === 'over') {
      ovTitle.textContent = 'Missed';
      ovStats.textContent = `Score ${game.score}   Best ${game.best}`;
      ovHint.textContent = '';
      playBtn.textContent = 'Play again';
    } else {
      ovTitle.textContent = 'Dunk Shot';
      ovStats.textContent = game.best ? `Best ${game.best}` : '';
      ovHint.textContent = 'Drag down and back, then let go. Bank it off the walls, but a clean swish scores more.';
      playBtn.textContent = 'Play';
    }
    overlay.classList.remove('hidden');
    playBtn.focus({ preventScroll: true });
  }

  playBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    resetGame();
  });

  /* ---------------- boot ---------------- */
  loadBest();
  resetGame();            // builds the first hoops so the title screen has a scene behind it
  game.mode = 'title';    // ...but don't accept input until Play is pressed
  showOverlay('title');
  requestAnimationFrame(frame);
})();

/* =====================================================================
   11. EXTENSION BITS  -  the "you're back online" banner
   ---------------------------------------------------------------------
   background.js redirects the dead tab to this page and passes the URL you
   were trying to reach as ?from=... . When the connection returns we offer
   a one-click way back. We never auto-redirect, because that would yank you
   out of a run mid-shot.
   ===================================================================== */
(() => {
  const net    = document.getElementById('net');
  const netMsg = document.getElementById('netMsg');
  const netBtn = document.getElementById('netBtn');

  // Read ?from=... and make sure it is a normal web address before trusting it.
  // (Never navigate to a URL from a query string without checking its scheme.)
  let target = null;
  try {
    const u = new URL(new URLSearchParams(location.search).get('from'));
    if (u.protocol === 'http:' || u.protocol === 'https:') target = u;
  } catch (e) { /* no ?from= (opened from the toolbar icon) */ }

  if (!target) return;             // opened via the toolbar: nothing to go back to

  function sync() {
    if (navigator.onLine) {
      netMsg.textContent = `You're back online.`;
      netBtn.textContent = `Open ${target.hostname}`;
      net.classList.remove('hidden');
    } else {
      net.classList.add('hidden');
    }
  }
  netBtn.addEventListener('click', () => { location.href = target.href; });
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
})();
