/* POS Retail Front â€” Bootstrap 5
   Autor: ChatGPT (para Eudy)
   Persistencia simple en localStorage
*/

// ========================== Datos Mock ==========================
const MOCK_PRODUCTOS = [
  { id: "105479", nombre: "Agarradera Recta 45 cm", sku: "AB-1145", categoria: "Accesorios", precio: 65266.80, iva: 21, pesoKg: 0.9, stock: 25, img: "", barcode: "0000105479", multiplo: 1, unidad: "Un" },
  { id: "200111", nombre: "Taladro Percutor 700W", sku: "TP-700", categoria: "Herramientas", precio: 125999.90, iva: 21, pesoKg: 3.2, stock: 7, img: "", barcode: "200111200111", multiplo: 1, unidad: "Un" },
  { id: "300222", nombre: "Cemento 50Kg", sku: "CM-50", categoria: "Materiales", precio: 8999.00, iva: 10.5, pesoKg: 50, stock: 120, img: "", barcode: "300222300222", multiplo: 1, unidad: "Bolsa" },
  { id: "400333", nombre: "Pintura Blanca 4L", sku: "PB-4L", categoria: "Pinturas", precio: 22999.50, iva: 21, pesoKg: 5.0, stock: 32, img: "", barcode: "400333400333", multiplo: 1, unidad: "Lata" },
  { id: "500444", nombre: "Lija Grano 120", sku: "LJ-120", categoria: "Accesorios", precio: 999.99, iva: 21, pesoKg: 0.1, stock: 300, img: "", barcode: "500444500444", multiplo: 1, unidad: "Hoja" }
];

const MOCK_CLIENTES = [
  { id: "c1", nombre: "Consumidor final", doc: "00000000", email: "", telefono: "" },
  { id: "c2", nombre: "Eudy Espinoza", doc: "95981592", email: "eudy@ejemplo.com", telefono: "343-555-111" },
  { id: "c3", nombre: "Constructora Norte SA", doc: "30-12345678-9", email: "compras@norte.com", telefono: "011-555-222" }
];

// ========================== Estado ==========================
const state = {
  productos: [],
  filtered: [],
  carrito: {
    items: [],            // {id, nombre, precio, iva, cantidad, pesoKg, unidad, multiplo}
    descPorcentaje: 0,
    descMonto: 0,
    descMotivo: "",
    logistica: { tipo: "retiro", sucursal: "Central", fecha: "", direccion: "", costo: 0, obs: "" },
    cliente: { id: "c1", nombre: "Consumidor final" },
    pagos: []             // simulaciÃ³n multipago
  },
  filtros: { q: "", categoria: "", orden: "relevancia", coverage:"", minPrice:null, maxPrice:null, stockPos:true, stockZero:true, stockNeg:true, store:null },
  clientes: [],
  tema: "dark",
  currentPage: 1,
  itemsPerPage: 24
};

// ========================== Utilidades ==========================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const money = (n) => (n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// NormalizaciÃ³n ligera (acentos/caso)
function normalizeText(text = "") {
  try { return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase(); }
  catch { return String(text || "").trim().toLowerCase(); }
}

function isUnidadM2(unidad){
  const u = String(unidad||'').trim().toLowerCase();
  return u === 'm2' || u === 'mÂ²' || u === 'm^2';
}

function validarCantidadRetail(multiplo, cantidad){
  try{
    const m = (multiplo == null || isNaN(multiplo) || multiplo <= 0) ? 1 : parseFloat(Number(multiplo).toFixed(2));
    const num = isNaN(cantidad) ? m : Number(cantidad);
    const tolerance = 0.0001;
    const red = Number(num.toFixed(2));
    if (Math.abs(red % m) < tolerance || m === 1) return red;
    const ajustada = Math.ceil(red / m) * m;
    return Number(ajustada.toFixed(2));
  } catch { return Number(cantidad||1); }
}

// persistencia
function save() {
  try {
    const persist = {
      carrito: state.carrito,
      filtros: state.filtros,
      clientes: state.clientes,
      tema: state.tema,
      currentPage: state.currentPage,
      itemsPerPage: state.itemsPerPage,
    };
    localStorage.setItem("pos.front.state", JSON.stringify(persist));
  } catch (e) {
    console.warn('No se pudo guardar estado en localStorage:', e);
  }
}
function load() {
  try {
    const raw = localStorage.getItem("pos.front.state");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.carrito) Object.assign(state.carrito, parsed.carrito);
      if (parsed.filtros) Object.assign(state.filtros, parsed.filtros);
      if (parsed.clientes) state.clientes = parsed.clientes;
      if (parsed.tema) state.tema = parsed.tema;
      if (parsed.currentPage) state.currentPage = parsed.currentPage;
      if (parsed.itemsPerPage) state.itemsPerPage = parsed.itemsPerPage;
    }
  } catch { /* noop */ }
}

// ========================== InicializaciÃ³n ==========================
document.addEventListener("DOMContentLoaded", async () => {
  load();

  // Tema
  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      state.tema = savedTheme;
    }
  } catch {}
  document.documentElement.setAttribute("data-bs-theme", state.tema === "light" ? "light" : "dark");
  $("#btnToggleTheme").addEventListener("click", toggleTheme);

  // Inicializar inputs
  $("#inputBuscar").value = state.filtros.q || "";
  $("#inputBuscar").addEventListener("input", (e) => {
    state.filtros.q = e.target.value.trim();
    renderCatalogo();
  });

  $("#inputBarcode").addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      await buscarPorBarcodeAPI(e.target.value.trim());
      e.target.value = "";
    }
  });

  // Stores desde backend (si existen)
  try {
    const backendStores = JSON.parse(document.getElementById('backend-stores-data')?.textContent || '[]');
    const lastStore = JSON.parse(document.getElementById('backend-last-store-data')?.textContent || 'null');
    if (backendStores?.length) {
      state.filtros.store = lastStore || backendStores[0];
      const sel = document.getElementById('storeFilterRetail');
      if (sel) sel.value = state.filtros.store;
    }
  } catch {}

  $("#selectCategoria").addEventListener("change", (e) => {
    state.filtros.categoria = e.target.value;
    renderCatalogo();
  });

  $("#selectOrden").value = state.filtros.orden || "relevancia";
  $("#selectOrden").addEventListener("change", (e) => {
    state.filtros.orden = e.target.value;
    renderCatalogo();
  });

  $("#btnLimpiarFiltros").addEventListener("click", () => {
    state.filtros = { q: "", categoria: "", orden: "relevancia", coverage:"", minPrice:null, maxPrice:null, stockPos:true, stockZero:true, stockNeg:true, store: state.filtros.store };
    $("#inputBuscar").value = "";
    $("#selectCategoria").value = "";
    $("#selectOrden").value = "relevancia";
    document.getElementById('coverageGroupFilterRetail').value = '';
    document.getElementById('minPriceRetail').value = '';
    document.getElementById('maxPriceRetail').value = '';
    document.getElementById('stockPos').checked = true;
    document.getElementById('stockZero').checked = true;
    document.getElementById('stockNeg').checked = true;
    renderCatalogo();
  });

  // Carrito botones
  $("#btnLimpiarCliente").addEventListener("click", () => {
    state.carrito.cliente = { id: "c1", nombre: "Consumidor final" };
    $("#lblCliente").textContent = state.carrito.cliente.nombre;
    save();
    saveCartRemote();
  });

  $("#btnAplicarDescuento").addEventListener("click", () => { aplicarDescuento(); saveCartRemote(); });
  $("#btnAplicarLogistica").addEventListener("click", () => { aplicarLogistica(); saveCartRemote(); });
  $("#btnAgregarPago").addEventListener("click", () => { agregarFilaPago(); saveCartRemote(); });
  $("#btnLimpiarPagos").addEventListener("click", () => { state.carrito.pagos = []; renderSimuladorPagos(); saveCartRemote(); });
  $("#btnConfirmarPagos").addEventListener("click", confirmarSimulacionPagos);
  $("#btnPresupuesto").addEventListener("click", imprimirPresupuesto);
  $("#btnFacturar").addEventListener("click", facturar);

  // Modal clientes
  $("#btnNuevoCliente").addEventListener("click", crearClienteMock);
  const clientSearchInput = document.getElementById('clientSearchInput');
  // Búsqueda normalizada (acentos/ñ → n)
// removed stray search block: const qn = normalizeText(state.filtros.q || '');
// removed stray: if (qn) {
// removed stray: productos = productos.filter(p => {
// removed stray: const nNombre = normalizeText(p.nombre || '');
// removed stray: const nSku = normalizeText(p.sku || '');
// removed stray: const nId = normalizeText(String(p.id || ''));
// removed stray: const nCat = normalizeText(p.categoria || '');
// removed stray: return nNombre.includes(qn) || nSku.includes(qn) || nId.includes(qn) || nCat.includes(qn);
// removed stray: });
// removed stray: };
  if (clientSearchInput) {
    clientSearchInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const query = clientSearchInput.value.trim();
        const results = document.getElementById('clientSearchResults');
        results.innerHTML = '';
        if (!query || query.length < 3) {
          results.innerHTML = '<p class="text-muted">IngresÃ¡ al menos 3 caracteres y presionÃ¡ Enter.</p>';
          return;
        }
        try {
          const resp = await fetch(`/api/clientes/search?query=${encodeURIComponent(query)}`);
          if (!resp.ok) throw new Error('Error en bÃºsqueda');
          const clientes = await resp.json();
          if (!Array.isArray(clientes) || !clientes.length) {
            results.innerHTML = '<p class="text-muted">Sin resultados.</p>';
            return;
          }
          clientes.forEach(c => {
            const nombre = c.nombre_completo || c.nombre || `${c.nombre||''} ${c.apellido||''}`.trim() || c.numero_cliente || 'Cliente';
            const doc = c.nif || c.doc || c.dni || '';
            const btn = document.createElement('button');
            btn.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
            btn.innerHTML = `<div><div class="fw-medium">${nombre}</div><div class="small text-secondary">${doc} · ${(c.email||'')}</div></div><i class="bi bi-chevron-right"></i>`;
            btn.addEventListener('click', () => {
              // Guardar datos ampliados del cliente
              state.carrito.cliente = {
                id: c.numero_cliente || c.id || doc || nombre,
                numero_cliente: c.numero_cliente || c.id || doc || '',
                nombre: nombre,
                nif: c.nif || c.doc || c.dni || '',
                email: c.email || c.email_contacto || '',
                telefono: c.telefono || c.telefono_contacto || '',
                direccion_completa: c.direccion_completa || c.direccion || ''
              };
              renderCarrito();
              save();
              saveCartRemote();
        try {
          const el = document.getElementById('clientSearchModal') || document.getElementById('modalClientes');
          if (!el) return;
          if (window.bootstrap && window.bootstrap.Modal) window.bootstrap.Modal.getOrCreateInstance(el)?.hide();
          else if (window.__modalHideFallback) window.__modalHideFallback(el);
          else { el.classList.remove('show'); el.style.display='none'; }
        } catch(_){}
            });
            results.appendChild(btn);
          });
        } catch (err) {
          results.innerHTML = `<p class="text-danger">Error: ${err.message}</p>`;
        }
      }
    });
  }

  // Filtros adicionales (coverage, precio, stock, store)
  document.getElementById('coverageGroupFilterRetail')?.addEventListener('change', (e)=>{ state.filtros.coverage = e.target.value; renderCatalogo(); });
  document.getElementById('minPriceRetail')?.addEventListener('input', (e)=>{ state.filtros.minPrice = e.target.value? Number(e.target.value):null; renderCatalogo(); });
  document.getElementById('maxPriceRetail')?.addEventListener('input', (e)=>{ state.filtros.maxPrice = e.target.value? Number(e.target.value):null; renderCatalogo(); });
  document.getElementById('stockPos')?.addEventListener('change', (e)=>{ state.filtros.stockPos = e.target.checked; renderCatalogo(); });
  document.getElementById('stockZero')?.addEventListener('change', (e)=>{ state.filtros.stockZero = e.target.checked; renderCatalogo(); });
  document.getElementById('stockNeg')?.addEventListener('change', (e)=>{ state.filtros.stockNeg = e.target.checked; renderCatalogo(); });
  document.getElementById('storeFilterRetail')?.addEventListener('change', async (e)=>{
    state.filtros.store = e.target.value;
    try { await fetch('/api/update_last_store', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ store_id: state.filtros.store }) }); } catch {}
    state.currentPage = 1;
    await loadProductosAPI();
    poblarCategorias();
    try { poblarCoverageGroups(); } catch {}
    updateCartPricesRetail();
    renderCatalogo();
  });

  // Datos remotos: usuario, carrito y productos
  await loadUserInfo();
  await loadRemoteCart();
  await loadProductosAPI();

  // Render inicial
  $("#lblCliente").textContent = state.carrito.cliente?.nombre || "Consumidor final";
  poblarCategorias();
  try { poblarCoverageGroups(); } catch {}
  renderCatalogo();
  renderCarrito();

  // ========================== Fallback Bootstrap Modals ==========================
  // Si Bootstrap JS no cargó (CDN bloqueado), proveer una apertura/cierre básica de modales
  try {
    const hasBootstrap = () => (typeof window !== 'undefined' && window.bootstrap && window.bootstrap.Modal);

    function ensureBackdrop() {
      let bd = document.querySelector('.modal-backdrop');
      if (!bd) {
        bd = document.createElement('div');
        bd.className = 'modal-backdrop fade show';
        document.body.appendChild(bd);
      }
      return bd;
    }

    function showModalFallback(el) {
      if (!el) return;
      if (hasBootstrap()) { try { window.bootstrap.Modal.getOrCreateInstance(el).show(); return; } catch(_) {} }
      el.style.display = 'block';
      el.classList.add('show');
      document.body.classList.add('modal-open');
      ensureBackdrop();
    }

    function hideModalFallback(el) {
      if (!el) return;
      if (hasBootstrap()) { try { window.bootstrap.Modal.getOrCreateInstance(el).hide(); return; } catch(_) {} }
      el.classList.remove('show');
      el.style.display = 'none';
      document.body.classList.remove('modal-open');
      const bd = document.querySelector('.modal-backdrop');
      if (bd) bd.remove();
    }

    // Delegar clicks para abrir modales por data-bs-target sólo si no hay Bootstrap
    document.addEventListener('click', (ev) => {
      try {
        if (hasBootstrap()) return; // Bootstrap se encarga
        const trigger = ev.target.closest('[data-bs-toggle="modal"]');
        if (!trigger) return;
        const sel = trigger.getAttribute('data-bs-target');
        if (!sel) return;
        const target = document.querySelector(sel);
        if (!target) return;
        ev.preventDefault();
        showModalFallback(target);
      } catch(_) {}
    }, true);

    // Delegar cierre por data-bs-dismiss="modal" si no hay Bootstrap
    document.addEventListener('click', (ev) => {
      try {
        if (hasBootstrap()) return;
        const dism = ev.target.closest('[data-bs-dismiss="modal"]');
        if (!dism) return;
        const modal = ev.target.closest('.modal');
        if (modal) { ev.preventDefault(); hideModalFallback(modal); }
      } catch(_) {}
    }, true);

    // Exponer helpers para uso interno
    window.__modalShowFallback = showModalFallback;
    window.__modalHideFallback = hideModalFallback;
    window.openModalById = function(id){
      try{
        const el = document.getElementById(id);
        if(!el) return false;
        if (window.bootstrap && window.bootstrap.Modal){ window.bootstrap.Modal.getOrCreateInstance(el).show(); return true; }
        if (window.__modalShowFallback){ window.__modalShowFallback(el); return true; }
        el.style.display='block'; el.classList.add('show'); return true;
      } catch(_) { return false; }
    };
  } catch(_) { /* noop */ }

  // Nota: Bootstrap maneja data-bs-toggle/modal por sí mismo. No forzar aquí.
});

// ========================== Simulador externo (V5) ==========================
const SIM_V5_URL = window.SIMULATOR_V5_URL || '/maestros/simulador/';

function _cartTotalForSimulator() {
  try {
    if (typeof calcularTotales === 'function') {
      const t = calcularTotales();
      if (t && typeof t.total === 'number' && !isNaN(t.total)) return t.total;
    }
  } catch(_){}
  try {
    // Fallback: sumar items del carrito
    const items = (state && state.carrito && Array.isArray(state.carrito.items)) ? state.carrito.items : [];
    const sum = items.reduce((acc, it) => acc + Number(it.precio||0) * Number(it.cantidad||0), 0);
    if (!isNaN(sum)) return sum;
  } catch(_){}
  return 0;
}

function openExternalSimulator(){
  try {
    const base = SIM_V5_URL || '';
    const url = base + (base.includes('?') ? '&' : '?') + 'ts=' + Date.now();
    const frame = document.getElementById('simV5Frame');
    if (!frame) { window.open(url, '_blank'); return; }
    frame.src = url;
    try {
      const modalEl = document.getElementById('modalSimV5');
      if (window.bootstrap && window.bootstrap.Modal) {
        const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
      } else if (window.__modalShowFallback) {
        window.__modalShowFallback(modalEl);
      } else {
        window.open(url, '_blank');
      }
    } catch (e) {
      console.error('No se pudo abrir el modal del simulador:', e);
      try { window.open(url, '_blank'); } catch(_) {}
    }
    // Intentar pasar el total al simulador (same-origin o postMessage)
    const pushAmount = () => {
      try {
        const win = frame.contentWindow;
        const doc = win?.document;
        if (typeof win?.setCartAmount === 'function') {
          win.setCartAmount(Number(_cartTotalForSimulator()));
        }
        const input = doc?.getElementById('cartAmount');
        if (input) {
          const val = Number(_cartTotalForSimulator());
          input.value = String(val.toFixed(2));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        win?.postMessage({ type: 'set_cart_amount', cart_amount: Number(_cartTotalForSimulator()) }, '*');
      } catch (_) {
        frame.contentWindow?.postMessage({ type: 'set_cart_amount', cart_amount: Number(_cartTotalForSimulator()) }, '*');
      }
    };
    frame.onload = () => {
      pushAmount();
      setTimeout(pushAmount, 150);
      setTimeout(pushAmount, 400);
      setTimeout(pushAmount, 800);
    };
  } catch (err) {
    console.error('openExternalSimulator error', err);
    try { window.open((SIM_V5_URL || '/maestros/simulador/') + ((SIM_V5_URL||'').includes('?') ? '&' : '?') + 'ts=' + Date.now(), '_blank'); } catch(_){ }
  }
}

// ========================== Render CatÃ¡logo ==========================
function poblarCategorias() {
  const sel = $("#selectCategoria");
  if (!sel) return;
  const current = sel.value || "";
  sel.innerHTML = '<option value="">Todas</option>';
  const cats = Array.from(new Set(state.productos.map(p => p.categoria).filter(Boolean))).sort();
  cats.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  // Restablecer selecciÃ³n previa si existe
  if (current && cats.includes(current)) sel.value = current;
}

// Poblar Grupo Cobertura (normalizado para comparar, etiqueta original para mostrar)
function poblarCoverageGroups(){
  const sel = document.getElementById('coverageGroupFilterRetail');
  if (!sel) return;
  const current = state.filtros?.coverage || sel.value || '';
  sel.innerHTML = '<option value="">Todos</option>';
  const map = new Map(); // value(normalized) -> label(original)
  (state.productos||[]).forEach(p => {
    const label = p.grupo_cobertura || '';
    const value = normalizeText(label);
    if (value && !map.has(value)) map.set(value, label);
  });
  const items = Array.from(map.entries()).sort((a,b)=> (a[1]||'').localeCompare(b[1]||''));
  for (const [value, label] of items){
    const o = document.createElement('option');
    o.value = value; o.textContent = label || value;
    sel.appendChild(o);
  }
  if (current && map.has(current)) sel.value = current;
}

function renderCatalogo() {
  const cont = $("#gridCatalogo");
  cont.innerHTML = "";

  // aplicar filtros
  let productos = applyFiltersAndSort([...state.productos]);
  state.filtered = productos;

  // paginaciÃ³n
  const total = productos.length;
  const pages = Math.max(1, Math.ceil(total / state.itemsPerPage));
  if (state.currentPage > pages) state.currentPage = pages;
  const start = (state.currentPage - 1) * state.itemsPerPage;
  const end = start + state.itemsPerPage;
  const pageItems = productos.slice(start, end);

  if (!productos.length) {
    cont.innerHTML = `<div class="col-12">
      <div class="alert alert-warning">Sin resultados.</div>
    </div>`;
    renderPagination(0, 1);
    return;
  }

  pageItems.forEach(p => {
    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `
      <div class="card card-product border-0 h-100" data-product-id="${p.id}">
        <div class="image-container ratio ratio-4x3 rounded-top">
          <div class="image-skeleton shimmer"></div>
          <img data-src="/static/img/placeholder.jpg" alt="${p.nombre}" class="card-img-top product-image lazyload" style="cursor:pointer;">
        </div>
        <div class="card-body">
          <div class="text-center mb-1">
            <span class="badge badge-soft category-badge">${p.categoria || ''}</span>
          </div>
          <h6 class="card-title mb-0">${p.nombre}</h6>
          <div class="small text-secondary mt-1">SKU: ${p.sku} · Stock: ${p.stock}</div>
          <div class="fw-bold fs-5 mt-2">${money(p.precio)}</div>
          <div class="d-flex mt-2 gap-2">
            <button class="btn btn-outline-secondary btn-sm btn-stock" data-id="${p.id}" data-name="${p.nombre}"><i class="bi bi-box-seam"></i> Stock</button>
            <button class="btn btn-primary btn-sm flex-fill btn-add" data-id="${p.id}"><i class="bi bi-cart-plus"></i> Agregar</button>
          </div>
        </div>
      </div>
    `;
    cont.appendChild(col);

    col.querySelector(".btn-add").addEventListener("click", () => showQuantityModalRetail(p));
    col.querySelector(".btn-stock").addEventListener("click", (ev) => { ev.stopPropagation(); openStockModal(p.id, p.nombre); });
    col.querySelector(".product-image").addEventListener("click", () => openProductDetails(p));
    col.querySelector(".card-product").addEventListener("click", (e) => { if (!e.target.closest('button')) openProductDetails(p); });
  });

  // Cargar imÃ¡genes (lazy)
  try { cargarImagenesCards(productos); } catch {}
  save();

  renderPagination(total, pages);
  try { renderActiveFiltersChips(); } catch(_) {}
}

function applyFiltersAndSort(arr){
  let productos = arr;
  // Búsqueda normalizada (acentos/ñ → n)
  const qn = normalizeText(state.filtros.q || '');
  if (qn) {
    productos = productos.filter(p => {
      const nNombre = normalizeText(p.nombre || '');
      const nSku = normalizeText(p.sku || '');
      const nId = normalizeText(String(p.id || ''));
      const nCat = normalizeText(p.categoria || '');
      return nNombre.includes(qn) || nSku.includes(qn) || nId.includes(qn) || nCat.includes(qn);
    });
  }if (state.filtros.categoria) {
    productos = productos.filter(p => p.categoria === state.filtros.categoria);
  }
  if (state.filtros.coverage) productos = productos.filter(p => normalizeText(p.grupo_cobertura||'') === state.filtros.coverage);
  if (state.filtros.minPrice != null) productos = productos.filter(p => Number(p.precio||0) >= state.filtros.minPrice);
  if (state.filtros.maxPrice != null) productos = productos.filter(p => Number(p.precio||0) <= state.filtros.maxPrice);
  productos = productos.filter(p => {
    const s = Number(p.stock||0);
    if (s > 0 && state.filtros.stockPos) return true;
    if (s === 0 && state.filtros.stockZero) return true;
    if (s < 0 && state.filtros.stockNeg) return true;
    return false;
  });
  // orden
  switch (state.filtros.orden) {
    case "precio_asc": productos.sort((a, b) => a.precio - b.precio); break;
    case "precio_desc": productos.sort((a, b) => b.precio - a.precio); break;
    case "nombre_asc": productos.sort((a, b) => (a.nombre||'').localeCompare(b.nombre||'')); break;
    default: /* relevancia */ break;
  }
  return productos;
}

function renderPagination(total, pages){
  const el = document.getElementById('paginationRetail');
  if (!el) return;
  el.innerHTML = '';
  if (pages <= 1) return;
  const mkBtn = (label, page, disabled=false, active=false)=>{
    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${active? 'btn-primary':'btn-outline-secondary'}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', ()=>{ state.currentPage = page; renderCatalogo(); });
    return btn;
  };
  const group = document.createElement('div');
  group.className = 'btn-group';
  group.appendChild(mkBtn('Â«', 1, state.currentPage===1));
  group.appendChild(mkBtn('â€¹', Math.max(1, state.currentPage-1), state.currentPage===1));
  for (let p = 1; p <= pages; p++){
    group.appendChild(mkBtn(String(p), p, false, p===state.currentPage));
  }
  group.appendChild(mkBtn('â€º', Math.min(pages, state.currentPage+1), state.currentPage===pages));
  group.appendChild(mkBtn('Â»', pages, state.currentPage===pages));
  el.appendChild(group);
}

// ========================== Chips de filtros activos ==========================
function renderActiveFiltersChips(){
  const wrap = document.getElementById("activeFiltersChips");
  if (!wrap) return;
  const f = state.filtros || {};
  const chips = [];
  const addChip = (key, label, onClear) => {
    const div = document.createElement("div");
    div.className = "filter-chip";
    div.innerHTML = `<span>${label}</span><button type="button" class="btn-clear" aria-label="Quitar"><i class="bi bi-x"></i></button>`;
    div.querySelector(".btn-clear").addEventListener("click", (e)=>{ e.preventDefault(); onClear(); renderCatalogo(); });
    chips.push(div);
  };
  if (f.q) addChip("q", `Buscar: "${f.q}"`, ()=>{ f.q=""; const el=document.getElementById("inputBuscar"); if(el){ el.value=""; } });
  if (f.categoria){
    const sel = document.getElementById("selectCategoria");
    const text = sel ? (sel.options[sel.selectedIndex]?.text || f.categoria) : f.categoria;
    addChip("categoria", `Categoría: ${text}`, ()=>{ f.categoria=""; const el=document.getElementById("selectCategoria"); if(el){ el.value=""; } });
  }
  if (f.coverage){
    const sel = document.getElementById("coverageGroupFilterRetail");
    const text = sel ? (sel.options[sel.selectedIndex]?.text || f.coverage) : f.coverage;
    addChip("coverage", `Cobertura: ${text}`, ()=>{ f.coverage=""; const el=document.getElementById("coverageGroupFilterRetail"); if(el){ el.value=""; } });
  }
  if (f.minPrice != null) addChip("minPrice", `Precio ≥ ${Number(f.minPrice).toFixed(2)}`, ()=>{ f.minPrice=null; const el=document.getElementById("minPriceRetail"); if(el){ el.value=""; } });
  if (f.maxPrice != null) addChip("maxPrice", `Precio ≤ ${Number(f.maxPrice).toFixed(2)}`, ()=>{ f.maxPrice=null; const el=document.getElementById("maxPriceRetail"); if(el){ el.value=""; } });
  if (!(f.stockPos && f.stockZero && f.stockNeg)){
    const parts = []; if (f.stockPos) parts.push("+"); if (f.stockZero) parts.push("0"); if (f.stockNeg) parts.push("-");
    addChip("stock", `Stock: ${parts.join("/")}`, ()=>{ f.stockPos = f.stockZero = f.stockNeg = true; ["stockPos","stockZero","stockNeg"].forEach(id=>{ const el=document.getElementById(id); if(el){ el.checked=true; } }); });
  }
  if (f.store){ addChip("store", `Sucursal: ${f.store}`, ()=>{}); }
  wrap.innerHTML="";
  chips.forEach(c => wrap.appendChild(c));
}

// === Imagen modal ===
let modalImages = [];
let modalIndex = 0;
function showImageModal(productId){
  findAvailableImages(productId).then(images => {
    modalImages = images.length? images: ['/static/img/default.jpg'];
    modalIndex = 0;
    const img = document.getElementById('modalImage');
    if (!img) return;
    img.src = modalImages[0];
    const imgModalEl = document.getElementById('imageModal');
    if (imgModalEl) {
      const modal = bootstrap.Modal.getOrCreateInstance(imgModalEl);
      modal.show();
    }
  });
}

document.getElementById('imgPrev')?.addEventListener('click', ()=>{
  if (!modalImages.length) return;
  modalIndex = (modalIndex - 1 + modalImages.length) % modalImages.length;
  document.getElementById('modalImage').src = modalImages[modalIndex];
});
document.getElementById('imgNext')?.addEventListener('click', ()=>{
  if (!modalImages.length) return;
  modalIndex = (modalIndex + 1) % modalImages.length;
  document.getElementById('modalImage').src = modalImages[modalIndex];
});

async function findAvailableImages(productId){
  const checks = [1,2,3].map(i => getImageUrl(productId,i));
  const results = await Promise.all(checks.map(url => imageExists(url, productId, 0).then(exists => exists? url: null)));
  return results.filter(Boolean);
}

// === Stock modal ===
async function openStockModal(productId, name){
  const store = state.filtros.store || '';
  try{
    const resp = await fetch(`/api/stock/${productId}/${store}`);
    const data = await resp.json();
    const tbody = document.getElementById('stockModalBody');
    document.getElementById('stockProdTitle').textContent = `${productId} â€” ${name}`;
    tbody.innerHTML = '';
    const rows = Array.isArray(data)? data: [];
    let sumVenta = 0, sumEntrega = 0, sumComp = 0;
    rows.forEach(r => {
      const venta = Number(r.disponible_venta ?? r.stock_venta ?? r.disponible ?? 0) || 0;
      const entrega = Number(r.disponible_entrega ?? r.disponible_ent ?? 0) || 0;
      const comp = Number(r.comprometido ?? r.reservado ?? 0) || 0;
      sumVenta += venta; sumEntrega += entrega; sumComp += comp;
      const nombreAlmacen = r.almacen || r.almacen_nombre || r.warehouse || r.Warehouse || r.store || '-';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${nombreAlmacen}</td><td>${numAR(venta)}</td><td>${numAR(entrega)}</td><td>${numAR(comp)}</td>`;
      tbody.appendChild(tr);
    });
    document.getElementById('totalVentaRetail').textContent = numAR(sumVenta);
    document.getElementById('totalEntregaRetail').textContent = numAR(sumEntrega);
    document.getElementById('totalCompRetail').textContent = numAR(sumComp);
    const stockModalEl = document.getElementById('stockModalRetail');
    if (stockModalEl) {
      bootstrap.Modal.getOrCreateInstance(stockModalEl).show();
    }
  }catch(e){ console.error(e); toast('No se pudo cargar stock'); }
}

function numAR(n){ return Number(n||0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// === Product details modal ===
function openProductDetails(p){
  document.getElementById('productDetailsTitle').textContent = p.nombre;
  document.getElementById('productDetailsSku').textContent = p.id;
  document.getElementById('productDetailsCat').textContent = p.categoria || '-';
  document.getElementById('productDetailsCov').textContent = p.grupo_cobertura || '-';
  document.getElementById('productDetailsPrice').textContent = money(p.precio);
  document.getElementById('productDetailsStock').textContent = p.stock;
  obtenerImagenProducto(p.id).then(url => { document.getElementById('productDetailsImage').src = url; }).catch(()=>{});
  // Cargar atributos desde API (si disponible)
  try {
    fetch(`/producto/atributos/${p.id}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const attrs = Array.isArray(data.attributes) ? data.attributes : [];
        const modalBody = document.querySelector('#productDetailsModal .modal-body');
        if (!modalBody) return;
        let attrsBlock = document.getElementById('productDetailsAttrsBlock');
        if (!attrsBlock){
          attrsBlock = document.createElement('div');
          attrsBlock.id = 'productDetailsAttrsBlock';
          attrsBlock.className = 'mt-3';
          const h = document.createElement('h6'); h.textContent = 'Atributos';
          const ul = document.createElement('ul'); ul.id = 'productDetailsAttrs'; ul.className = 'list-unstyled mb-0';
          attrsBlock.appendChild(h); attrsBlock.appendChild(ul);
          modalBody.appendChild(attrsBlock);
        }
        const ul = document.getElementById('productDetailsAttrs');
        if (ul){
          ul.innerHTML = '';
          if (!attrs.length){
            const li = document.createElement('li'); li.textContent = 'Sin atributos disponibles'; ul.appendChild(li);
          } else {
            attrs.forEach(a => {
              const name = a.AttributeName || a.name || 'Atributo';
              const value = a.AttributeValue || a.value || '-';
              const li = document.createElement('li');
              li.innerHTML = `<strong>${name}:</strong> ${value}`;
              ul.appendChild(li);
            });
          }
        }
      }).catch(()=>{});
  } catch {}
  {
    const detailsEl = document.getElementById('productDetailsModal');
    if (detailsEl) {
      bootstrap.Modal.getOrCreateInstance(detailsEl).show();
    }
  }
}

async function buscarPorBarcodeAPI(code) {
  if (!code) return;
  try {
    const url = `/api/productos/by_code?code=${encodeURIComponent(code)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Producto no encontrado');
    const arr = await resp.json();
    const it = normalizeProduct(arr[0]);
    // inyectar si no estÃ¡ en catÃ¡logo para futuro render
    if (!state.productos.find(p => p.id === it.id)) state.productos.unshift(it);
    addToCart(it.id, 1);
    saveCartRemote();
    const offEl = document.getElementById('offCarrito');
    if (offEl) bootstrap.Offcanvas.getOrCreateInstance(offEl).show();
  } catch (e) {
    console.warn(e);
    toast("No se encontrÃ³ producto para ese cÃ³digo.");
  }
}

// ========================== Carrito ==========================
function addToCart(id, cantidad = 1) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;

  const existing = state.carrito.items.find(x => x.id === id);
  if (existing) {
    existing.cantidad = clamp(existing.cantidad + cantidad, 0, 9999);
  } else {
    state.carrito.items.push({
      id: p.id, nombre: p.nombre, precio: p.precio, iva: p.iva,
      cantidad: cantidad, pesoKg: p.pesoKg, unidad: p.unidad, multiplo: p.multiplo
    });
  }
  renderCarrito();
  save();
  saveCartRemote();
}

function removeFromCart(id) {
  state.carrito.items = state.carrito.items.filter(x => x.id !== id);
  renderCarrito();
  save();
  saveCartRemote();
}

function setCantidad(id, cant) {
  const it = state.carrito.items.find(x => x.id === id);
  if (!it) return;
  const raw = Number(cant || 0);
  const valid = validarCantidadRetail(Number(it.multiplo||1), raw);
  it.cantidad = clamp(valid, 0, 999999);
  renderCarrito();
  save();
  saveCartRemote();
}

function calcularTotales() {
  const { items, descPorcentaje, descMonto, logistica } = state.carrito;

  let subtotal = 0, impuestos = 0, peso = 0, unidades = 0;

  items.forEach(it => {
    const neto = it.precio * it.cantidad;
    const ivaMonto = neto * (it.iva / 100);
    subtotal += neto;
    impuestos += ivaMonto;
    peso += (it.pesoKg || 0) * it.cantidad;
    unidades += it.cantidad;
  });

  // descuentos
  const descPorcMonto = subtotal * (Number(descPorcentaje) / 100);
  const descuentos = Number(descMonto || 0) + descPorcMonto;

  // logÃ­stica
  const costoEnvio = Number(logistica?.costo || 0);

  const total = Math.max(0, subtotal - descuentos + impuestos + costoEnvio);

  return { subtotal, descuentos, impuestos, costoEnvio, total, peso, unidades };
}

function renderCarrito() {
  // lista
  const list = $("#listCarrito");
  list.innerHTML = "";

  if (!state.carrito.items.length) {
    list.innerHTML = `<div class="list-group-item">No hay productos en el carrito.</div>`;
  } else {
    state.carrito.items.forEach(it => {
      const li = document.createElement("div");
      li.className = "list-group-item d-flex justify-content-between align-items-start";
      const qtyValue = isUnidadM2(it.unidad) ? Number(it.cantidad||0).toFixed(2) : Number(it.cantidad||0);
      li.innerHTML = `
        <div class="me-2">
          <div class="fw-medium">${it.nombre}</div>
          <div class="small text-secondary">IVA ${it.iva}% · ${money(it.precio)} · ${it.unidad}${(calcCajasRetail(it.cantidad, it.multiplo, it.unidad) ? ' · ' + calcCajasRetail(it.cantidad, it.multiplo, it.unidad) : '')}</div>
          <div class="d-flex align-items-center gap-2 mt-1">
            <input type="number" class="form-control form-control-sm" value="${qtyValue}" min="0" step="${it.multiplo||1}" style="width: 90px">
            <span class="small">${money(it.precio * it.cantidad)}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-outline-danger btn-sm"><i class="bi bi-trash"></i></button>
        </div>
      `;
      list.appendChild(li);

      const [inputCant, btnDel] = li.querySelectorAll("input,button");
      inputCant.addEventListener("change", (e) => setCantidad(it.id, e.target.value));
      btnDel.addEventListener("click", () => removeFromCart(it.id));
    });
  }

  // Datos del cliente en panel
  try {
    const c = state.carrito?.cliente || null;
    if (c) {
      document.getElementById('lblCliente').textContent = c.nombre || c.nombre_cliente || 'Consumidor final';
      const docEl = document.getElementById('lblClienteDoc');
      const conEl = document.getElementById('lblClienteContacto');
      const dirEl = document.getElementById('lblClienteDireccion');
      if (docEl) docEl.textContent = (c.numero_cliente ? `Código: ${c.numero_cliente}` : '') + (c.nif ? `  •  ${c.nif}` : '');
      if (conEl) conEl.textContent = [c.email, c.telefono].filter(Boolean).join(' · ');
      if (dirEl) dirEl.textContent = c.direccion_completa || '';
    }
  } catch(_){}

  // totales
  const t = calcularTotales();
  $("#totSubtotal").textContent = money(t.subtotal);
  $("#totDescuentos").textContent = money(t.descuentos);
  $("#totImpuestos").textContent = money(t.impuestos);
  $("#totTotal").textContent = money(t.total);
  $("#totPeso").textContent = `${(t.peso || 0).toFixed(2)} kg / ${t.unidades}`;
  $("#badgeCount").textContent = state.carrito.items.reduce((a, b) => {
    const qty = Number(b.cantidad) || 0;
    return a + (isUnidadM2(b.unidad) ? Math.round(qty / (Number(b.multiplo) || 1)) : qty);
  }, 0);

  // actualizar simulador
  $("#simTotal").textContent = money(t.total);
  actualizarRestanteSimulador();
  // Persistencia remota
  saveCartRemote();
}

// ========================== Descuentos ==========================
function aplicarDescuento() {
  const p = Number($("#descPorcentaje").value || 0);
  const m = Number($("#descMonto").value || 0);
  state.carrito.descPorcentaje = clamp(p, 0, 100);
  state.carrito.descMonto = Math.max(0, m);
  state.carrito.descMotivo = $("#descMotivo").value.trim();
  renderCarrito();
  save();
  {
    const el = document.getElementById('modalDescuentos');
    if (el) {
      try {
        if (window.bootstrap && window.bootstrap.Modal) window.bootstrap.Modal.getOrCreateInstance(el).hide();
        else if (window.__modalHideFallback) window.__modalHideFallback(el);
        else { el.classList.remove('show'); el.style.display = 'none'; }
      } catch(_) { try { if (window.__modalHideFallback) window.__modalHideFallback(el); } catch(_) {} }
    }
  }
}

// ========================== LogÃ­stica ==========================
function aplicarLogistica() {
  state.carrito.logistica = {
    tipo: $("#logTipoEntrega").value,
    sucursal: $("#logSucursal").value,
    fecha: $("#logFecha").value,
    direccion: $("#logDireccion").value.trim(),
    costo: Number($("#logCosto").value || 0),
    obs: $("#logObs").value.trim()
  };
  renderCarrito();
  save();
  {
    const el = document.getElementById('modalLogistica');
    if (el) {
      try {
        if (window.bootstrap && window.bootstrap.Modal) window.bootstrap.Modal.getOrCreateInstance(el).hide();
        else if (window.__modalHideFallback) window.__modalHideFallback(el);
        else { el.classList.remove('show'); el.style.display = 'none'; }
      } catch(_) { try { if (window.__modalHideFallback) window.__modalHideFallback(el); } catch(_) {} }
    }
  }
}

// Al abrir modal de Logística, precargar dirección del cliente si corresponde
document.getElementById('modalLogistica')?.addEventListener('shown.bs.modal', () => {
  try {
    const tipo = document.getElementById('logTipoEntrega')?.value || 'retiro';
    const dir = state?.carrito?.cliente?.direccion_completa || '';
    if (tipo === 'envio' && dir) {
      const input = document.getElementById('logDireccion');
      if (input && !input.value) input.value = dir;
    }
  } catch(_){}
});

// Si cambia a "envio", intentar setear dirección del cliente
document.getElementById('logTipoEntrega')?.addEventListener('change', (e) => {
  try {
    if (e.target.value === 'envio') {
      const dir = state?.carrito?.cliente?.direccion_completa || '';
      if (dir) document.getElementById('logDireccion').value = dir;
    }
  } catch(_){}
});

// ========================== Clientes ==========================
async function renderListaClientesAPI() {
  const cont = $("#listaClientes");
  const q = ($("#buscarCliente").value || "").trim();
  cont.innerHTML = "";
  if (!q) return;
  try {
    const resp = await fetch(`/api/clientes/search?query=${encodeURIComponent(q)}`);
    if (!resp.ok) throw new Error('Error buscando clientes');
    const lista = await resp.json();
    lista.forEach(c => {
      const nombre = c.nombre_completo || c.nombre || `${c.nombre} ${c.apellido}` || c.numero_cliente || 'Cliente';
      const doc = c.nif || c.doc || c.dni || '';
      const a = document.createElement("button");
      a.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
      a.innerHTML = `
        <div>
          <div class="fw-medium">${nombre}</div>
          <div class="small text-secondary">${doc} · ${(c.email||'')}</div>
        </div>
        <i class="bi bi-chevron-right"></i>
      `;
      a.addEventListener("click", () => {
        state.carrito.cliente = {
          id: c.numero_cliente || c.id || doc || nombre,
          numero_cliente: c.numero_cliente || c.id || doc || '',
          nombre: nombre,
          nif: c.nif || c.doc || c.dni || '',
          email: c.email || c.email_contacto || '',
          telefono: c.telefono || c.telefono_contacto || '',
          direccion_completa: c.direccion_completa || c.direccion || ''
        };
        renderCarrito();
        save();
        saveCartRemote();
        try {
          const el = document.getElementById('clientSearchModal') || document.getElementById('modalClientes');
          if (!el) return;
          if (window.bootstrap && window.bootstrap.Modal) window.bootstrap.Modal.getOrCreateInstance(el)?.hide();
          else if (window.__modalHideFallback) window.__modalHideFallback(el);
          else { el.classList.remove('show'); el.style.display='none'; }
        } catch(_){}
      });
      cont.appendChild(a);
    });
  } catch(e) {
    console.error(e);
    toast('Error al buscar clientes');
  }
}
function crearClienteMock() {
  const nombre = prompt("Nombre del cliente:");
  if (!nombre) return;
  const id = "c" + (state.clientes.length + 1);
  state.clientes.push({ id, nombre, doc: "", email: "", telefono: "" });
  save();
  renderListaClientes();
}

// ========================== Simulador de pagos ==========================
function tiposPagoOptionsHTML() {
  return `
    <option value="efectivo">Efectivo</option>
    <option value="debito">Tarjeta DÃ©bito</option>
    <option value="credito">Tarjeta CrÃ©dito</option>
    <option value="transferencia">Transferencia</option>
    <option value="cheque">Cheque</option>
  `;
}

function tarjetasCreditoOptionsHTML() {
  return `
    <option value="">-- Seleccione --</option>
    <option value="visa">Visa</option>
    <option value="master">Mastercard</option>
    <option value="amex">American Express</option>
  `;
}

function agregarFilaPago() {
  state.carrito.pagos.push({ tipo: "efectivo", monto: 0, cuotas: 1, tarjeta: "", interes: 0, referencia: "" });
  renderSimuladorPagos();
}

function renderSimuladorPagos() {
  const cont = $("#contenedorPagos");
  cont.innerHTML = "";

  const tot = calcularTotales().total;
  $("#simTotal").textContent = money(tot);

  state.carrito.pagos.forEach((pago, idx) => {
    const row = document.createElement("div");
    row.className = "card border-0 shadow-sm";
    row.innerHTML = `
      <div class="card-body row g-2 align-items-end">
        <div class="col-12 col-md-3">
          <label class="form-label">Medio</label>
          <select class="form-select tipo">
            ${tiposPagoOptionsHTML()}
          </select>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label d-flex justify-content-between align-items-center">Monto
            <button type="button" class="btn btn-sm btn-outline-primary rounded-pill completar">Completar restante</button>
          </label>
          <input type="number" class="form-control monto" min="0" step="0.01" value="${pago.monto}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">InterÃ©s %</label>
          <input type="number" class="form-control interes" min="0" step="0.01" value="${pago.interes}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">Cuotas</label>
          <input type="number" class="form-control cuotas" min="1" step="1" value="${pago.cuotas}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">Tarjeta</label>
          <select class="form-select tarjeta">
            ${tarjetasCreditoOptionsHTML()}
          </select>
        </div>
        <div class="col-12 col-md-1 d-grid">
          <button class="btn btn-outline-danger rem"><i class="bi bi-trash"></i></button>
        </div>
        <div class="col-12">
          <label class="form-label">Referencia (Ãºltimos 4, comprobante, etc.)</label>
          <input type="text" class="form-control ref" value="${pago.referencia || ""}">
        </div>
      </div>
    `;
    cont.appendChild(row);

    // set valores
    row.querySelector(".tipo").value = pago.tipo;
    row.querySelector(".tarjeta").value = pago.tarjeta || "";

    // listeners
    row.querySelector(".tipo").addEventListener("change", (e) => { pago.tipo = e.target.value; actualizarRestanteSimulador(); save(); });
    row.querySelector(".monto").addEventListener("input", (e) => { pago.monto = Number(e.target.value || 0); actualizarRestanteSimulador(); save(); });
    row.querySelector(".interes").addEventListener("input", (e) => { pago.interes = Number(e.target.value || 0); actualizarRestanteSimulador(); save(); });
    row.querySelector(".cuotas").addEventListener("input", (e) => { pago.cuotas = clamp(Number(e.target.value || 1), 1, 60); actualizarRestanteSimulador(); save(); });
    row.querySelector(".tarjeta").addEventListener("change", (e) => { pago.tarjeta = e.target.value; save(); });
    row.querySelector(".ref").addEventListener("input", (e) => { pago.referencia = e.target.value; save(); });
    row.querySelector(".rem").addEventListener("click", () => { state.carrito.pagos.splice(idx,1); renderSimuladorPagos(); save(); });
    row.querySelector(".completar").addEventListener("click", () => {
      const t = calcularTotales().total;
      const pagado = state.carrito.pagos.reduce((a,p,i)=> a + (Number(i===idx?0:p.monto)||0) * (1 + Number(p.interes||0)/100), 0);
      const rest = Math.max(0, t - pagado);
      pago.monto = parseFloat(rest.toFixed(2));
      row.querySelector('.monto').value = pago.monto;
      actualizarRestanteSimulador();
      save();
    });
  });

  actualizarRestanteSimulador();
}

function actualizarRestanteSimulador() {
  const total = calcularTotales().total;
  const totalConIntereses = state.carrito.pagos.reduce((acc, p) => acc + (Number(p.monto) * (1 + Number(p.interes)/100)), 0);
  const restante = Math.max(0, total - totalConIntereses);
  $("#simRestante").textContent = money(restante);
}

function confirmarSimulacionPagos() {
  // Solo validamos que cubra el total (o lo avise)
  const total = calcularTotales().total;
  const pagado = state.carrito.pagos.reduce((acc, p) => acc + (Number(p.monto) * (1 + Number(p.interes)/100)), 0);
  if (pagado + 0.01 < total) {
    if (!confirm("El total ingresado no cubre el monto a pagar. Â¿Continuar igualmente?")) return;
  }
  {
    const el = document.getElementById('modalPagos');
    if (el) {
      try {
        if (window.bootstrap && window.bootstrap.Modal) window.bootstrap.Modal.getOrCreateInstance(el).hide();
        else if (window.__modalHideFallback) window.__modalHideFallback(el);
        else { el.classList.remove('show'); el.style.display='none'; }
      } catch(_) { try { if (window.__modalHideFallback) window.__modalHideFallback(el); } catch(_) {} }
    }
  }
  toast("SimulaciÃ³n de pagos guardada.");
}

// ========================== IntegraciÃ³n con APIs ==========================
function parseMoneyString(s){
  if (typeof s === 'number') return s;
  const v = String(s||'').trim();
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(v)) return parseFloat(v.replace(/\./g,'').replace(',','.'));
  const n = parseFloat(v); return isNaN(n)?0:n;
}

// ========================== Carrito: modal cantidad ==========================
let currentProductToAdd = null;
function showQuantityModalRetail(p){
  currentProductToAdd = {
    id: p.id,
    nombre: p.nombre,
    precio: Number(p.precio||0),
    multiplo: Number(p.multiplo||1) || 1,
    unidad: p.unidad || 'Un',
    iva: p.iva || 21
  };
  document.getElementById('quantityModalProductNameRetail').textContent = p.nombre;
  document.getElementById('quantityModalProductPriceRetail').textContent = money(currentProductToAdd.precio);
  const input = document.getElementById('quantityInputRetail');
  {
    const vc = validarCantidadRetail(currentProductToAdd.multiplo, currentProductToAdd.multiplo);
    input.value = isUnidadM2(currentProductToAdd.unidad) ? Number(vc).toFixed(2) : vc;
  }
  input.min = currentProductToAdd.multiplo;
  input.step = String(Number(currentProductToAdd.multiplo||1).toFixed(2));
  document.getElementById('quantityModalUnitMeasureRetail').textContent = currentProductToAdd.unidad;
  document.getElementById('quantityModalCajasRetail').textContent = calcCajasRetail(Number(input.value), currentProductToAdd.multiplo, currentProductToAdd.unidad);
  updateTotalRetail();
  {
    const el = document.getElementById('quantityModalRetail');
    if (el) {
      try {
        if (window.bootstrap && window.bootstrap.Modal) {
          const modal = window.bootstrap.Modal.getOrCreateInstance(el);
          modal.show();
        } else if (window.__modalShowFallback) {
          window.__modalShowFallback(el);
        } else {
          el.style.display = 'block'; el.classList.add('show');
        }
      } catch(_) { try { if (window.__modalShowFallback) window.__modalShowFallback(el); } catch(_) {} }
    }
  }
}

function calcCajasRetail(cantidad, multiplo, unidad){
  if (!['m2','M2'].includes(unidad)) return '';
  const cajas = (Number(cantidad)||0) / (Number(multiplo)||1);
  return `Equivalente a ${Math.round(cajas)} caja${Math.round(cajas)===1?'':'s'}`;
}

document.getElementById('btnQtyDecRetail')?.addEventListener('click', (e)=>{ e.preventDefault(); adjustQuantityRetail(-1); });
document.getElementById('btnQtyIncRetail')?.addEventListener('click', (e)=>{ e.preventDefault(); adjustQuantityRetail(1); });
document.getElementById('btnQtyAddRetail')?.addEventListener('click', addToCartConfirmedRetail);

function adjustQuantityRetail(delta){
  if (!currentProductToAdd) return;
  const input = document.getElementById('quantityInputRetail');
  let qty = Number(input.value)||currentProductToAdd.multiplo;
  qty += delta * currentProductToAdd.multiplo;
  if (qty < currentProductToAdd.multiplo) qty = currentProductToAdd.multiplo;
  qty = validarCantidadRetail(currentProductToAdd.multiplo, qty);
  input.value = isUnidadM2(currentProductToAdd.unidad) ? Number(qty).toFixed(2) : qty;
  document.getElementById('quantityModalCajasRetail').textContent = calcCajasRetail(qty, currentProductToAdd.multiplo, currentProductToAdd.unidad);
  updateTotalRetail();
}

function updateTotalRetail(){
  if (!currentProductToAdd) return;
  const qty = Number(document.getElementById('quantityInputRetail').value)||currentProductToAdd.multiplo;
  const total = currentProductToAdd.precio * qty;
  document.getElementById('quantityModalTotalRetail').textContent = money(total);
}

function addToCartConfirmedRetail(){
  if (!currentProductToAdd) return;
  const raw = Number(document.getElementById('quantityInputRetail').value)||currentProductToAdd.multiplo;
  const qty = validarCantidadRetail(currentProductToAdd.multiplo, raw);
  const existing = state.carrito.items.find(x => x.id === currentProductToAdd.id);
  if (existing){ existing.cantidad = (existing.cantidad||0) + qty; existing.precio = currentProductToAdd.precio; existing.iva = currentProductToAdd.iva; existing.unidad = currentProductToAdd.unidad; }
  else {
    state.carrito.items.push({ id: currentProductToAdd.id, nombre: currentProductToAdd.nombre, precio: currentProductToAdd.precio, iva: currentProductToAdd.iva, cantidad: qty, unidad: currentProductToAdd.unidad, multiplo: currentProductToAdd.multiplo });
  }
  renderCarrito();
  save();
  saveCartRemote();
  try { bootstrap.Modal.getInstance(document.getElementById('quantityModalRetail'))?.hide(); } catch(_){}
  currentProductToAdd = null;
}

// Observaciones en carrito
document.getElementById('cartObservationsRetail')?.addEventListener('input', (e)=>{
  state.carrito.observaciones = e.target.value;
  saveCartRemote();
});

// Actualizar precios de carrito segÃºn store/productos cargados
function updateCartPricesRetail(){
  const map = new Map(state.productos.map(p => [String(p.id), p]));
  (state.carrito.items||[]).forEach(it => {
    const p = map.get(String(it.id));
    if (p){
      it.precio = Number(p.precio||0);
      it.iva = p.iva||it.iva;
      it.unidad = p.unidad||it.unidad;
      it.multiplo = Number(p.multiplo||it.multiplo||1);
    }
  });
  renderCarrito();
}

function normalizeProduct(p){
  // Mapea resultado de /api/productos a estructura local
  return {
    id: p.numero_producto || p.productId || p.id,
    nombre: p.nombre_producto || p.productName || p.nombre || 'Producto',
    sku: p.numero_producto || p.sku || '',
    categoria: p.categoria_producto || p.categoria || '',
    precio: parseMoneyString(p.precio_final_con_descuento ?? p.precio_final_con_iva ?? p.precio),
    iva: p.iva || 21,
    pesoKg: p.pesoKg || 0,
    stock: parseMoneyString(p.total_disponible_venta ?? p.stock) || 0,
    grupo_cobertura: p.grupo_cobertura || '',
    img: '',
    barcode: p.barcode || '',
    multiplo: p.multiplo || 1,
    unidad: p.unidad_medida || p.unidad || 'Un',
  };
}

async function loadProductosAPI(){
  try{
    const store = state.filtros.store || 'BA001GC';
    const pageSize = 5000;
    let page = 1;
    let all = [];
    while (true){
      const url = `/api/productos?store=${encodeURIComponent(store)}&page=${page}&items_per_page=${pageSize}`;
      const resp = await fetch(url);
      if(!resp.ok) throw new Error('Error al cargar productos');
      const chunk = await resp.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all = all.concat(chunk);
      if (chunk.length < pageSize) break;
      page += 1;
      if (page > 200) break; // safety guard
    }
    state.productos = all.map(normalizeProduct);
  }catch(e){ console.error('loadProductosAPI', e); toast('No se pudieron cargar productos'); }
}

let currentUserEmail = null;
async function loadUserInfo(){
  try{
    const resp = await fetch('/api/user_info');
    if(resp.ok){ const j = await resp.json(); currentUserEmail = j.email; }
  }catch{}
}

async function loadRemoteCart(){
  try{
    const resp = await fetch('/api/get_user_cart');
    if(resp.ok){ const cart = await resp.json(); if(cart && typeof cart === 'object'){ Object.assign(state.carrito, cart); } }
  }catch(e){ console.warn('No se pudo cargar carrito remoto', e); }
}

let saveTimer = null;
function saveCartRemote(){
  if(!currentUserEmail) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      const payload = { userId: currentUserEmail, cart: state.carrito, timestamp: new Date().toISOString() };
      await fetch('/api/save_user_cart', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    }catch(e){ console.warn('No se pudo guardar carrito remoto', e); }
  }, 400);
}

// ========================== Presupuesto / ImpresiÃ³n ==========================
function imprimirPresupuesto(){ try{ if (typeof generatePdfOnly === 'function') { generatePdfOnly(); return; } else { toast('Generador de presupuesto no disponible'); } } catch(e){ console.error('imprimirPresupuesto error:', e); toast('Error inesperado al generar presupuesto'); } }

// ========================== FacturaciÃ³n (Front) ==========================
// En el front sÃ³lo preparamos el payload que luego enviarÃ­as a tu API de facturaciÃ³n (ARCA/AFIP/etc.)
function facturar() {
  if (!state.carrito.items.length) {
    toast("El carrito estÃ¡ vacÃ­o.");
    return;
  }
  const payload = buildFacturaPayload();
  console.log("Payload de FacturaciÃ³n (enviar a API):", payload);
  toast("Factura lista para enviar a la API (ver Consola).");
}

function buildFacturaPayload() {
  const t = calcularTotales();
  return {
    cliente: state.carrito.cliente,
    items: state.carrito.items.map(it => ({
      id: it.id, nombre: it.nombre, cantidad: it.cantidad, precio_unit: it.precio, iva: it.iva, unidad: it.unidad
    })),
    descuentos: {
      porcentaje: state.carrito.descPorcentaje,
      monto: state.carrito.descMonto,
      motivo: state.carrito.descMotivo
    },
    logistica: state.carrito.logistica,
    pagos: state.carrito.pagos, // simulaciÃ³n (puede alimentar tu backend)
    totales: calcularTotales(),
    metadata: {
      origen: "pos-web",
      fecha: new Date().toISOString()
    }
  };
}

// ========================== Atajos ==========================
function handleHotkeys(e) {
  if (e.ctrlKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#inputBuscar").focus();
    $("#inputBuscar").select();
    return;
  }
  const open = (sel) => { const el = document.querySelector(sel); if (el) bootstrap.Modal.getOrCreateInstance(el).show(); };
  switch (e.key) {
    case "F1": e.preventDefault(); open("#modalAtajos"); break;
    case "F2": {
      e.preventDefault();
      const el = document.getElementById('offCarrito');
      if (el) bootstrap.Offcanvas.getOrCreateInstance(el).toggle();
      break;
    }
    case "F6": e.preventDefault(); open("#modalDescuentos"); break;
    case "F7": e.preventDefault(); open("#modalLogistica"); break;
    case "F8": e.preventDefault(); try { openExternalSimulator(); } catch(_) {} break;
    case "F9": e.preventDefault(); imprimirPresupuesto(); break;
    case "F10": e.preventDefault(); facturar(); break;
  }
}

// Activar atajos globales en esta vista (evitar interferir al escribir)
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
  // Permitir Ctrl+K aunque estÃ© escribiendo; bloquear otras teclas cuando escribe
  if (isTyping && !(e.ctrlKey && e.key.toLowerCase() === 'k')) return;
  try { handleHotkeys(e); } catch(_) {}
});

// ========================== Tema ==========================
function toggleTheme() {
  const doc = document.documentElement;
  const now = doc.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
  doc.setAttribute("data-bs-theme", now);
  state.tema = now;
  save();
}

// ========================== Toast bÃ¡sico ==========================
function toast(msg) {
  const div = document.createElement("div");
  div.className = "position-fixed top-0 end-0 p-3";
  div.style.zIndex = 1080;
  div.innerHTML = `
    <div class="toast align-items-center text-bg-dark border-0 show" role="alert">
      <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

// ========================== ImÃ¡genes (lazy) ==========================
async function obtenerImagenProducto(productId){
  const defImg = '/static/img/default.jpg';
  const cacheKey = `img_cache_${productId}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return cached;
  const checks = [1,2,3].map(i => ({ url: getImageUrl(productId,i,'medium'), i }));
  const results = await Promise.all(checks.map(c => imageExists(c.url, productId, c.i).then(exists => ({ url:c.url, exists }))));
  const first = results.find(r=>r.exists)?.url || defImg;
  sessionStorage.setItem(cacheKey, first);
  return first;
}

// Variante grid: usar medium (small no disponible)
async function obtenerImagenProductoForGrid(productId){
  const defImg = '/static/img/default.jpg';
  const cacheKey = `img_cache_grid_${productId}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return cached;
  const checks = [1,2,3].map(i => ({ url: getImageUrl(productId,i,'medium'), i }));
  const results = await Promise.all(checks.map(c => imageExists(c.url, productId, c.i).then(exists => ({ url:c.url, exists }))));
  const first = results.find(r=>r.exists)?.url || defImg;
  sessionStorage.setItem(cacheKey, first);
  return first;
}

function getImageUrl(productId, index, size='medium'){
  const safe = (size==='small'||size==='medium'||size==='large') ? size : 'medium';
  return `https://productimages.familiabercomat.com/${safe}/${productId}_000_00${index}.jpg`;
}

function imageExists(url, productId, index){
  const cacheKey = `img_cache_${productId}_${index}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached !== null) return Promise.resolve(cached === 'true');
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { localStorage.setItem(cacheKey, 'true'); resolve(true); };
    img.onerror = () => { localStorage.setItem(cacheKey, 'false'); resolve(false); };
    img.src = url;
  });
}

async function cargarImagenesCards(productos){
  for(const p of productos){
    const card = document.querySelector(`.card[data-product-id="${p.id}"]`);
    if(card){
      const img = card.querySelector('.product-image');
      img.setAttribute('data-src', await obtenerImagenProductoForGrid(p.id));
    }
  }
  initLazyLoading();
}

function initLazyLoading(){
  const lazyImages = document.querySelectorAll('img.lazyload');
  if ('IntersectionObserver' in window){
    const observer = new IntersectionObserver((entries, obs)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          const img = entry.target;
          const dataSrc = img.getAttribute('data-src');
          const container = img.closest('.image-container');
          const spinner = container?.querySelector('.image-spinner');
          const skeleton = container?.querySelector('.image-skeleton');
          if (dataSrc){
            img.src = dataSrc;
            img.onload = ()=>{ if(spinner) spinner.style.display='none'; if (skeleton) skeleton.style.display='none'; img.classList.add('loaded'); img.classList.remove('lazyload'); obs.unobserve(img); };
            img.onerror = ()=>{ if(spinner) spinner.style.display='none'; if (skeleton) skeleton.style.display='none'; img.src = '/static/img/default.jpg'; };
            img.removeAttribute('data-src');
          }
        }
      })
    }, { rootMargin: '100px', threshold: 0.1 });
    lazyImages.forEach(img=>{ if(img.getAttribute('data-src')) observer.observe(img); });
  } else {
    lazyImages.forEach(img=>{ const dataSrc=img.getAttribute('data-src'); if(dataSrc){ img.src=dataSrc; img.onload=()=>{ const cont=img.closest('.image-container'); const sp=cont?.querySelector('.image-spinner'); const sk=cont?.querySelector('.image-skeleton'); if(sp) sp.style.display='none'; if(sk) sk.style.display='none'; img.classList.add('loaded'); img.classList.remove('lazyload'); }; img.removeAttribute('data-src'); }});
  }
}











// Expose function for inline onclick usage
try { window.openExternalSimulator = openExternalSimulator; } catch(_) {}







