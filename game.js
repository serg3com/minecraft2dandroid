(() => {
  // =========================
  //         CANVAS
  // =========================
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }
  addEventListener("resize", resize);
  resize();

  let W = innerWidth, H = innerHeight;
  function updateWH(){ W = innerWidth; H = innerHeight; }
  addEventListener("resize", updateWH);

  // =========================
  //          GAME
  // =========================
  const TILE = 24;
  const WORLD_W = 220;
  const WORLD_H = 85;

  const GRAVITY = 2400;
  const JUMP_V = 880;
  const MOVE_SPEED = 220;
  const RUN_SPEED = 360;

  const DAY_CYCLE_SEC = 300;
  const WIN_DAYS = 7;
  const HUNGER_DRAIN_PER_SEC = 1/60; // 1 min = -1

  // Blocks: id -> {name, color, solid, mineTime, dropItem}
  const BLOCKS = {
    0: {name:"air", color:null, solid:false, mine:0, drop:null},
    1: {name:"grass", color:"#50a050", solid:true, mine:0.45, drop:1},
    2: {name:"dirt", color:"#6e5037", solid:true, mine:0.40, drop:2},
    3: {name:"stone", color:"#7b7b8a", solid:true, mine:0.85, drop:3},
    4: {name:"wood", color:"#91704a", solid:true, mine:0.65, drop:4},
    5: {name:"plank", color:"#af8c5f", solid:true, mine:0.55, drop:5},
    7: {name:"water", color:"#2d78d2", solid:false, mine:0, drop:null},
    8: {name:"chest", color:"#aa783c", solid:true, mine:0.35, drop:8},
    9: {name:"furnace", color:"#5b5b60", solid:true, mine:0.65, drop:9},
  };

  // Items: id -> {name, color, type}
  const ITEMS = {
    1:{name:"grass", color:"#50a050", type:"block"},
    2:{name:"dirt",  color:"#6e5037", type:"block"},
    3:{name:"stone", color:"#7b7b8a", type:"block"},
    4:{name:"wood",  color:"#91704a", type:"block"},
    5:{name:"plank", color:"#af8c5f", type:"block"},
    8:{name:"chest", color:"#aa783c", type:"block"},
    9:{name:"furnace", color:"#5b5b60", type:"block"},
    20:{name:"apple", color:"#d64646", type:"food"},
    21:{name:"meat_raw", color:"#d28a8a", type:"food"},
    22:{name:"meat_cooked", color:"#d2aa5a", type:"food"},
    40:{name:"coal", color:"#222", type:"material"},
    41:{name:"iron_ore", color:"#8a8aa0", type:"material"},
    42:{name:"iron_ingot", color:"#d6d6ea", type:"material"},
    30:{name:"pickaxe", color:"#e6e65a", type:"tool"},
  };
  const ITEM_ID = Object.fromEntries(Object.entries(ITEMS).map(([k,v]) => [v.name, Number(k)]));

  const RECIPES = [
    [{wood:1}, {plank:4}],
    [{plank:8}, {chest:1}],
    [{stone:8}, {furnace:1}],
    [{plank:3, stone:2}, {pickaxe:1}],
  ];

  const SMELT_RECIPES = {
    meat_raw: {out:"meat_cooked", sec:6},
    iron_ore: {out:"iron_ingot", sec:8},
  };
  const FUEL_VALUE = {wood:10, plank:8, coal:20};

  function clamp(v,a,b){ return v<a?a : v>b?b : v; }

  // =========================
  //          WORLD
  // =========================
  const world = Array.from({length: WORLD_H}, () => new Uint16Array(WORLD_W));
  const heights = new Int16Array(WORLD_W);

  function getTile(tx,ty){
    if (tx<0||ty<0||tx>=WORLD_W||ty>=WORLD_H) return 3;
    return world[ty][tx];
  }
  function setTile(tx,ty,v){
    if (tx<0||ty<0||tx>=WORLD_W||ty>=WORLD_H) return;
    world[ty][tx]=v;
  }

  function genWorld(){
    let h = 44;
    for(let x=0;x<WORLD_W;x++){
      h += [-1,0,0,0,1][(Math.random()*5)|0];
      h = clamp(h, 34, 58);
      heights[x]=h;

      for(let y=h;y<WORLD_H;y++){
        if (y===h) setTile(x,y,1);
        else if (y<h+4) setTile(x,y,2);
        else setTile(x,y,3);
      }
    }

    // pond
    for(let x=18;x<40;x++){
      for(let y=43;y<49;y++){
        if (getTile(x,y)===0) setTile(x,y,7);
      }
    }

    // trees
    for(let i=0;i<50;i++){
      const x = 6 + (Math.random()*(WORLD_W-13)|0);
      const y = heights[x]-1;
      const trunk = 3 + (Math.random()*4|0);
      for(let k=0;k<trunk;k++) setTile(x,y-k,4);
      for(let dx=-2;dx<=2;dx++){
        for(let dy=-2;dy<=0;dy++){
          if (Math.random()<0.62 && getTile(x+dx, y-trunk+dy)===0) setTile(x+dx, y-trunk+dy, 5);
        }
      }
    }
  }

  // =========================
  //        INVENTORY
  // =========================
  class Inventory {
    constructor(slots=25){
      this.slots = Array.from({length:slots}, ()=>null); // {id,count}
      this.selected = 0;
    }
    add(id,count=1){
      for(let i=0;i<this.slots.length;i++){
        const s=this.slots[i];
        if (s && s.id===id){ s.count+=count; return true; }
      }
      for(let i=0;i<this.slots.length;i++){
        if (!this.slots[i]){ this.slots[i]={id, count}; return true; }
      }
      return false;
    }
    getSelected(){ return this.slots[this.selected]; }
    removeOneSelected(){
      const s=this.getSelected(); if(!s) return null;
      s.count -= 1;
      const id=s.id;
      if (s.count<=0) this.slots[this.selected]=null;
      return id;
    }
    countName(name){
      const iid=ITEM_ID[name]; let t=0;
      for(const s of this.slots) if(s && s.id===iid) t+=s.count;
      return t;
    }
    takeName(name,count){
      const iid=ITEM_ID[name]; let left=count;
      for(let i=0;i<this.slots.length;i++){
        const s=this.slots[i];
        if(!s || s.id!==iid) continue;
        const take=Math.min(left, s.count);
        s.count-=take; left-=take;
        if (s.count<=0) this.slots[i]=null;
        if(left===0) return true;
      }
      return false;
    }
    hasNeed(need){
      for(const [nm,c] of Object.entries(need)){
        if(this.countName(nm)<c) return false;
      }
      return true;
    }
    craft(need, give){
      if(!this.hasNeed(need)) return false;
      for(const [nm,c] of Object.entries(need)) this.takeName(nm,c);
      for(const [nm,c] of Object.entries(give)) this.add(ITEM_ID[nm], c);
      return true;
    }
  }

  // =========================
  //          PLAYER
  // =========================
  const player = {
    x: 12*TILE, y: 12*TILE,
    w: 18, h: 42,
    vx:0, vy:0,
    onGround:false,
    hp:100, hunger:100,
    inv: new Inventory(25),
    attackCd:0,
  };
  player.inv.add(ITEM_ID.apple, 4);
  player.inv.add(ITEM_ID.plank, 12);

  // =========================
  //        CHESTS + FURNACE
  // =========================
  const CHESTS = new Map(); // key "x,y" -> Inventory(12)
  function chestLoot(){
    const inv=new Inventory(12);
    if(Math.random()<0.9) inv.add(ITEM_ID.plank, 2+(Math.random()*7|0));
    if(Math.random()<0.7) inv.add(ITEM_ID.apple, 1+(Math.random()*2|0));
    if(Math.random()<0.6) inv.add(ITEM_ID.coal, 1+(Math.random()*3|0));
    if(Math.random()<0.55) inv.add(ITEM_ID.iron_ore, 1+(Math.random()*3|0));
    if(Math.random()<0.35) inv.add(ITEM_ID.pickaxe, 1);
    return inv;
  }

  const furnace = { input:null, output:null, prog:0, fuel:0 };

  function furnaceLoad(){
    const sel=player.inv.getSelected(); if(!sel) return false;
    const name=ITEMS[sel.id].name;
    if(!SMELT_RECIPES[name]) return false;
    if(furnace.input!==null) return false;
    furnace.input=name;
    player.inv.removeOneSelected();
    return true;
  }
  function furnaceFuel(){
    const sel=player.inv.getSelected(); if(!sel) return false;
    const name=ITEMS[sel.id].name;
    if(FUEL_VALUE[name]==null) return false;
    player.inv.removeOneSelected();
    furnace.fuel += FUEL_VALUE[name];
    return true;
  }
  function furnaceTake(){
    if(!furnace.output) return false;
    player.inv.add(ITEM_ID[furnace.output], 1);
    furnace.output=null;
    return true;
  }
  function furnaceUpdate(dt){
    if(!furnace.input){ furnace.prog=0; return; }
    if(furnace.fuel<=0) return;
    const r=SMELT_RECIPES[furnace.input];
    furnace.fuel = Math.max(0, furnace.fuel - dt);
    furnace.prog += dt;
    if(furnace.prog>=r.sec){
      furnace.prog=0;
      furnace.input=null;
      furnace.output=r.out;
    }
  }

  // =========================
  //        VILLAGE
  // =========================
  function placeHouse(x0){
    const width=10, height=6;
    const groundY = heights[x0]-1;
    const baseY = groundY - height;
    for(let x=x0;x<x0+width;x++){
      for(let y=baseY;y<=groundY;y++){
        if(y===groundY) continue;
        const border = (x===x0||x===x0+width-1||y===baseY||y===groundY-1);
        if(border && getTile(x,y)===0) setTile(x,y,5);
      }
    }
    const doorX = x0 + (width/2|0);
    setTile(doorX, groundY-2, 0);
    setTile(doorX, groundY-3, 0);

    const cx=x0+2, cy=groundY-2;
    setTile(cx,cy,8);
    CHESTS.set(`${cx},${cy}`, chestLoot());

    const fx=x0+width-3, fy=groundY-2;
    setTile(fx,fy,9);
  }

  // =========================
  //          PHYSICS
  // =========================
  function rectCollides(x,y,w,h){
    const left = Math.floor(x/TILE);
    const right = Math.floor((x+w)/TILE);
    const top = Math.floor(y/TILE);
    const bot = Math.floor((y+h)/TILE);
    for(let ty=top-1; ty<=bot+1; ty++){
      for(let tx=left-1; tx<=right+1; tx++){
        const id=getTile(tx,ty);
        if(id!==0 && BLOCKS[id].solid){
          const rx=tx*TILE, ry=ty*TILE;
          if (x < rx+TILE && x+w > rx && y < ry+TILE && y+h > ry) return true;
        }
      }
    }
    return false;
  }
  function moveCollide(dx,dy){
    player.x += dx;
    if(rectCollides(player.x, player.y, player.w, player.h)){
      player.x -= dx;
      const step = dx>0?1:-1;
      for(let i=0;i<Math.abs(dx)|0;i++){
        player.x += step;
        if(rectCollides(player.x, player.y, player.w, player.h)){ player.x -= step; break; }
      }
    }
    player.y += dy;
    if(rectCollides(player.x, player.y, player.w, player.h)){
      player.y -= dy;
      const step = dy>0?1:-1;
      for(let i=0;i<Math.abs(dy)|0;i++){
        player.y += step;
        if(rectCollides(player.x, player.y, player.w, player.h)){ player.y -= step; break; }
      }
    }
  }

  // =========================
  //      INPUT (TOUCH)
  // =========================
  let invOpen=false, invTab="craft";
  let chestOpen=false, openChestKey=null;

  const btnJump = document.getElementById("btnJump");
  const btnUse  = document.getElementById("btnUse");
  const btnHit  = document.getElementById("btnHit");
  const btnInv  = document.getElementById("btnInv");
  const btnLeft  = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");

  const invPanel = document.getElementById("invPanel");
  const invGrid  = document.getElementById("invGrid");
  const craftRow = document.getElementById("craftRow");
  const smeltBox = document.getElementById("smeltBox");
  const smeltStatus = document.getElementById("smeltStatus");
  const tabCraft = document.getElementById("tabCraft");
  const tabSmelt = document.getElementById("tabSmelt");
  const tabClose = document.getElementById("tabClose");

  const hpFill = document.getElementById("hpFill");
  const hunFill = document.getElementById("hunFill");
  const hudText = document.getElementById("hudText");
  const hotbar = document.getElementById("hotbar");

  let jumpDown=false;
  let useTap=false;
  let hitDown=false;
  let leftDown =false;
  let rightDown =false;

  // aiming point (where to interact)
  let aimX = () => W/2;
  let aimY = () => H/2;

  function setInvOpen(v){
    invOpen=v;
    invPanel.style.display = invOpen ? "block" : "none";
    if(invOpen){ renderInvUI(); }
  }

  function pointerPos(ev){
    const t = ev.touches ? ev.touches[0] : ev;
    return {x:t.clientX, y:t.clientY};
  }

  // Canvas touch sets aim point
  canvas.addEventListener("pointerdown", (e)=>{
    if(invOpen) return;
    aimX = () => e.clientX;
    aimY = () => e.clientY;
  });

  btnInv.addEventListener("pointerdown", (e)=>{ e.preventDefault(); setInvOpen(!invOpen); });

  btnJump.addEventListener("pointerdown", (e)=>{ e.preventDefault(); jumpDown=true; });
  btnJump.addEventListener("pointerup", (e)=>{ e.preventDefault(); jumpDown=false; });

  btnLeft.addEventListener("pointerdown", e => { e.preventDefault(); leftDown = true; });
  btnLeft.addEventListener("pointerup",   e => { e.preventDefault(); leftDown = false; });
  btnLeft.addEventListener("pointerleave",e => { leftDown = false; });

  btnRight.addEventListener("pointerdown", e => { e.preventDefault(); rightDown = true; });
  btnRight.addEventListener("pointerup",   e => { e.preventDefault(); rightDown = false; });
  btnRight.addEventListener("pointerleave",e => { rightDown = false; });

  btnUse.addEventListener("pointerdown", (e)=>{ e.preventDefault(); useTap=true; });
  btnHit.addEventListener("pointerdown", (e)=>{ e.preventDefault(); hitDown=true; });
  btnHit.addEventListener("pointerup", (e)=>{ e.preventDefault(); hitDown=false; });

  tabCraft.addEventListener("click", ()=>{ invTab="craft"; renderInvUI(); });
  tabSmelt.addEventListener("click", ()=>{ invTab="smelt"; renderInvUI(); });
  tabClose.addEventListener("click", ()=>setInvOpen(false));

  document.getElementById("btnLoad").addEventListener("click", ()=>{ furnaceLoad(); renderInvUI(); });
  document.getElementById("btnFuel").addEventListener("click", ()=>{ furnaceFuel(); renderInvUI(); });
  document.getElementById("btnTake").addEventListener("click", ()=>{ furnaceTake(); renderInvUI(); });

  // Keyboard fallback (PC testing)
  const keys = new Set();
  addEventListener("keydown", (e)=>{ keys.add(e.key.toLowerCase()); if(e.key==="e") setInvOpen(!invOpen); });
  addEventListener("keyup", (e)=>keys.delete(e.key.toLowerCase()));

  // =========================
  //      MINING LOGIC
  // =========================
  const mining = {active:false, tx:0, ty:0, prog:0};

  function mineMultiplier(){
    const sel=player.inv.getSelected();
    if(!sel) return 1;
    const item=ITEMS[sel.id];
    return (item.type==="tool" && item.name==="pickaxe") ? 2.2 : 1.0;
  }

  function eatSelected(){
    const sel=player.inv.getSelected(); if(!sel) return false;
    const it=ITEMS[sel.id];
    if(it.type!=="food") return false;
    if(it.name==="apple"){ player.hunger = clamp(player.hunger+22,0,100); player.hp=clamp(player.hp+3,0,100); }
    if(it.name==="meat_raw"){ player.hunger = clamp(player.hunger+12,0,100); player.hp=clamp(player.hp-2,0,100); }
    if(it.name==="meat_cooked"){ player.hunger = clamp(player.hunger+35,0,100); player.hp=clamp(player.hp+6,0,100); }
    sel.count -= 1; if(sel.count<=0) player.inv.slots[player.inv.selected]=null;
    return true;
  }

  function placeBlock(wx,wy){
    const sel=player.inv.getSelected(); if(!sel) return false;
    const it=ITEMS[sel.id];
    if(it.type!=="block") return false;
    const tx = Math.floor(wx/TILE), ty=Math.floor(wy/TILE);
    if(getTile(tx,ty)!==0) return false;

    // prevent inside player
    const rx=tx*TILE, ry=ty*TILE;
    if (player.x < rx+TILE && player.x+player.w > rx && player.y < ry+TILE && player.y+player.h > ry) return false;

    setTile(tx,ty, sel.id);
    sel.count -= 1; if(sel.count<=0) player.inv.slots[player.inv.selected]=null;
    if(sel.id===8 && !CHESTS.has(`${tx},${ty}`)) CHESTS.set(`${tx},${ty}`, chestLoot());
    return true;
  }

  function tryUse(wx,wy){
    const tx=Math.floor(wx/TILE), ty=Math.floor(wy/TILE);
    const id=getTile(tx,ty);
    if(id===8 && CHESTS.has(`${tx},${ty}`)){
      // open chest (simple: take 1 item per click in inv UI later)
      // For MVP: transfer 1 random item to player
      const inv=CHESTS.get(`${tx},${ty}`);
      for(let i=0;i<inv.slots.length;i++){
        const s=inv.slots[i];
        if(s){
          if(player.inv.add(s.id,1)){
            s.count-=1; if(s.count<=0) inv.slots[i]=null;
          }
          break;
        }
      }
      return true;
    }
    // else eat or place
    if(eatSelected()) return true;
    return placeBlock(wx,wy);
  }

  function mineTick(dt, wx, wy){
    const tx=Math.floor(wx/TILE), ty=Math.floor(wy/TILE);
    const bid=getTile(tx,ty);
    if(bid===0 || bid===7){ mining.active=false; mining.prog=0; return; }

    // range check
    const px=player.x+player.w/2, py=player.y+player.h/2;
    const bx=tx*TILE+TILE/2, by=ty*TILE+TILE/2;
    const maxR=6*TILE;
    if((px-bx)*(px-bx)+(py-by)*(py-by) > maxR*maxR){ mining.active=false; mining.prog=0; return; }

    if(mining.tx!==tx || mining.ty!==ty){
      mining.tx=tx; mining.ty=ty; mining.prog=0;
    }
    mining.active=true;
    mining.prog += dt * mineMultiplier();

    if(mining.prog >= BLOCKS[bid].mine){
      setTile(tx,ty,0);

      if(BLOCKS[bid].name==="stone"){
        const r=Math.random();
        if(r<0.10) player.inv.add(ITEM_ID.iron_ore,1);
        else if(r<0.20) player.inv.add(ITEM_ID.coal,1);
        else player.inv.add(ITEM_ID.stone,1);
      } else if(BLOCKS[bid].drop){
        player.inv.add(BLOCKS[bid].drop,1);
      }
      mining.active=false; mining.prog=0;
      renderInvUI();
    }
  }

  // =========================
  //      DAY / NIGHT
  // =========================
  let tDay=0, day=1;
  function isNight(){ return (tDay / DAY_CYCLE_SEC) >= 0.5; }

  function nightOverlay(){
    const p=tDay/DAY_CYCLE_SEC;
    let dark=0;
    if(p>=0.5){
      const mid = Math.abs(p-0.75)/0.25;
      dark = 170 - 70*mid;
    } else {
      dark = p>0.35 ? (70 * ((p-0.35)/0.15)) : 0;
    }
    dark = clamp(dark,0,190);
    if(dark<=0) return;
    ctx.fillStyle = `rgba(10,10,20,${dark/255})`;
    ctx.fillRect(0,0,W,H);
  }

  // =========================
  //          CAMERA
  // =========================
  let camX=0, camY=0;
  function updateCam(){
    camX = clamp(player.x - W/2, 0, WORLD_W*TILE - W);
    camY = clamp(player.y - H/2, 0, WORLD_H*TILE - H);
  }

  // =========================
  //           UI
  // =========================
  function renderHotbar(){
    hotbar.innerHTML="";
    for(let i=0;i<5;i++){
      const div=document.createElement("div");
      div.className="slot" + (player.inv.selected===i?" sel":"");
      const s=player.inv.slots[i];
      div.textContent = s ? `${ITEMS[s.id].name} x${s.count}` : "-";
      hotbar.appendChild(div);
    }
  }

  function renderInvUI(){
    // tabs style
    tabCraft.classList.toggle("active", invTab==="craft");
    tabSmelt.classList.toggle("active", invTab==="smelt");
    smeltBox.style.display = (invTab==="smelt") ? "block":"none";

    // inventory grid
    invGrid.innerHTML="";
    for(let i=0;i<player.inv.slots.length;i++){
      const c=document.createElement("div");
      c.className="cell" + (player.inv.selected===i?" sel":"");
      const s=player.inv.slots[i];
      c.innerHTML = s ? `<div>${ITEMS[s.id].name}</div><div>x${s.count}</div>` : `<div>-</div><div>&nbsp;</div>`;
      c.onclick=()=>{
        player.inv.selected=i;
        renderInvUI();
      };
      invGrid.appendChild(c);
    }

    // craft row
    craftRow.innerHTML="";
    if(invTab==="craft"){
      RECIPES.forEach((r,idx)=>{
        const [need,give]=r;
        const ok = player.inv.hasNeed(need);
        const giveName = Object.keys(give)[0];
        const giveCnt = give[giveName];
        const b=document.createElement("div");
        b.className="action";
        b.style.opacity = ok ? "1":"0.5";
        b.textContent = `CRAFT ${giveName} x${giveCnt}`;
        b.onclick=()=>{ player.inv.craft(need,give); renderInvUI(); };
        craftRow.appendChild(b);
      });
    }

    // smelt status
    if(invTab==="smelt"){
      const inp = furnace.input || "-";
      const outp = furnace.output || "-";
      smeltStatus.textContent = `input: ${inp}   output: ${outp}   fuel: ${furnace.fuel.toFixed(1)}s`;
    }

    renderHotbar();
  }

  // =========================
  //          DRAW
  // =========================
  function drawWorld(){
    // sky
    ctx.fillStyle = isNight()? "#0f1428" : "#5aaaff";
    ctx.fillRect(0,0,W,H);

    const x0 = Math.floor(camX / TILE);
    const y0 = Math.floor(camY / TILE);
    const x1 = x0 + Math.floor(W / TILE) + 3;
    const y1 = y0 + Math.floor(H / TILE) + 3;

    for(let ty=y0; ty<y1; ty++){
      for(let tx=x0; tx<x1; tx++){
        const id=getTile(tx,ty);
        if(id===0) continue;
        const b=BLOCKS[id];
        if(!b.color) continue;
        const rx = tx*TILE - camX;
        const ry = ty*TILE - camY;
        ctx.fillStyle = b.color;
        ctx.fillRect(rx,ry,TILE,TILE);
        ctx.strokeStyle = "rgba(0,0,0,.35)";
        ctx.strokeRect(rx,ry,TILE,TILE);
      }
    }

    // target highlight
    const ax = aimX(), ay = aimY();
    const tx = Math.floor((ax + camX)/TILE);
    const ty = Math.floor((ay + camY)/TILE);
    ctx.strokeStyle="#fff";
    ctx.lineWidth=2;
    ctx.strokeRect(tx*TILE - camX, ty*TILE - camY, TILE, TILE);

    // player
    ctx.fillStyle="#3cc0ff";
    ctx.fillRect(player.x - camX, player.y - camY, player.w, player.h);
    ctx.strokeStyle="#000";
    ctx.strokeRect(player.x - camX, player.y - camY, player.w, player.h);

    nightOverlay();
  }

  // =========================
  //          LOOP
  // =========================
  let last = performance.now();

  function tick(now){
    const dt = Math.min(0.05, (now-last)/1000);
    last = now;

    // time
    tDay += dt;
    if(tDay >= DAY_CYCLE_SEC){ tDay -= DAY_CYCLE_SEC; day += 1; }
    if(day > WIN_DAYS){
      // simple win screen
      ctx.fillStyle="#101015"; ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#fff"; ctx.font="28px ui-monospace";
      ctx.fillText("YOU SURVIVED 7 DAYS! GG", W/2-210, H/2);
      return;
    }

    // hunger
    player.hunger = clamp(player.hunger - HUNGER_DRAIN_PER_SEC*dt, 0, 100);
    if(player.hunger<=0) player.hp = clamp(player.hp - 10*dt, 0, 100);
    if(player.hp<=0){
      ctx.fillStyle="#101015"; ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#ffaaaa"; ctx.font="28px ui-monospace";
      ctx.fillText("YOU DIED", W/2-70, H/2);
      return;
    }

    // furnace
    furnaceUpdate(dt);

    // controls
    const uiBlocked = invOpen; // for MVP
    let move = 0;

     // ПК
    if (keys.has("a") || keys.has("arrowleft"))  move -= 1;
    if (keys.has("d") || keys.has("arrowright")) move += 1;

     // ТЕЛЕФОН
    if (leftDown)  move -= 1;
    if (rightDown) move += 1;

    let speed = keys.has("shift") ? RUN_SPEED : MOVE_SPEED;

    // touch “move”: for MVP we use keyboard only, but you can add joystick later.
    if(!uiBlocked){
      player.vx = move * speed;
      const wantJump = jumpDown || keys.has(" ");
      if(wantJump && player.onGround){ player.vy = -JUMP_V; player.onGround=false; }
      player.vy += GRAVITY*dt;

      moveCollide(player.vx*dt, player.vy*dt);

      // onGround check
      player.onGround = rectCollides(player.x, player.y+1, player.w, player.h);
      if(player.onGround && player.vy>0) player.vy=0;

      // hit hold mines
      if(hitDown){
        const wx = aimX() + camX, wy = aimY() + camY;
        mineTick(dt, wx, wy);
      } else {
        mining.active=false; mining.prog=0;
      }

      // use tap
      if(useTap){
        useTap=false;
        const wx = aimX() + camX, wy = aimY() + camY;
        tryUse(wx, wy);
      }
    }

    updateCam();

    // draw
    drawWorld();

    // HUD
    hpFill.style.width = `${player.hp}%`;
    hunFill.style.width = `${player.hunger}%`;
    hudText.textContent = `DAY ${day}/${WIN_DAYS}   ${isNight()?"NIGHT":"DAY"}   (INV to open)`;
    renderHotbar();

    requestAnimationFrame(tick);
  }

  // =========================
  //      START GAME
  // =========================
  genWorld();
  [65,95,130,155].forEach(placeHouse);

  setInvOpen(false);
  renderInvUI();
  requestAnimationFrame(tick);
})();
