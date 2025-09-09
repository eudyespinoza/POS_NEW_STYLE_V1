// PDF y Presupuesto para POS Retail (aislado de scripts.js)
// Implementa generatePDF y generatePdfOnly usando el carrito de POS (state.carrito)

(function(){
  // -------- Helpers locales --------
  function showToast(level, message){ try { if (typeof toast === 'function') return toast(message); } catch(_){} console[level==='danger'?'error':'log'](message); }
  function showSpinner(){ const s=document.getElementById('spinner'); if(s) s.style.display='flex'; }
  function hideSpinner(){ const s=document.getElementById('spinner'); if(s) s.style.display='none'; }
  async function fetchWithAuth(url, options={}){
    const merged = Object.assign({ credentials:'include', headers: { 'X-Requested-With':'XMLHttpRequest' } }, options);
    const resp = await fetch(url, merged);
    if(!resp.ok){ let data; try{ data=await resp.json(); }catch{}; const msg=(data&&data.error)||resp.statusText||'Error'; throw new Error(msg); }
    try { return await resp.json(); } catch { return {}; }
  }
  function toggleCart(){ try{ const el=document.getElementById('offCarrito'); if(!el) return; const oc=bootstrap.Offcanvas.getOrCreateInstance(el); oc.toggle(); }catch(_){} }
  function convertirMonedaANumero(valor){ if(valor==null) return 0; if(typeof valor==='number'&&isFinite(valor)) return parseFloat(valor.toFixed(2)); try{ let s=valor.toString().trim(); s=s.replace(/\u2212/g,'-'); s=s.replace(/[^0-9,.\-]/g,''); s=s.replace(/(?!^)-/g,''); if(s.includes(',')&&s.includes('.')){ s=s.replace(/\./g,'').replace(',', '.'); } else if(s.includes(',')){ s=s.replace(',', '.'); } const num=parseFloat(s); return isNaN(num)?0:parseFloat(num.toFixed(2)); }catch{ return 0; } }
  function formatearMoneda(valor){ if(typeof valor!=='number'||isNaN(valor)) return '0,00'; return valor.toLocaleString('es-AR',{minimumFractionDigits:2, maximumFractionDigits:2}); }

  // Preparar mapping desde POS (state.carrito) a las variables esperadas
  function prepareCartMapping(){
    const sc = (typeof state !== 'undefined' && state?.carrito)
      ? state.carrito
      : ((window.state && window.state.carrito) ? window.state.carrito : { items:[], cliente:null });
    const items = (sc.items||[]).map(it=>({
      productId: it.id || it.productId || it.sku || '',
      productName: it.nombre || it.descripcion || '',
      quantity: Number(it.cantidad || it.quantity || 1),
      unidadMedida: it.unidad || it.unidad_medida || 'un',
      price: Number(it.precio || it.price || 0),
      precioLista: Number(it.precioLista || it.precio || it.price || 0),
    })).filter(it=>it.productId);
    const client = sc.cliente || null;
    const obs = (document.getElementById('cartObservationsRetail')?.value || sc.observaciones || '')+'';
    // store
    let storeInput = document.getElementById('storeFilter');
    if(!storeInput){ const sel=document.getElementById('storeFilterRetail'); if(sel){ storeInput=document.createElement('input'); storeInput.type='hidden'; storeInput.id='storeFilter'; storeInput.value=sel.value||''; document.body.appendChild(storeInput); } }
    // Exponer globales como en scripts.js
    window.cart = { items, client };
    window.cartObservations = obs;
    return { items, client, obs };
  }

  // -------- generatePDF (basado en scripts.js, adaptado) --------
  window.lastQuotationNumber = window.lastQuotationNumber || null;
  window.generatePDF = function(){
    return new Promise((resolve, reject)=>{
      try {
        if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF){ showToast('danger','Error: jsPDF no está cargado'); return reject(new Error('jsPDF no está definido')); }
        const { jsPDF } = window.jspdf; const doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4'});
        doc.setFont('helvetica','normal'); const PAGE_HEIGHT=doc.internal.pageSize.getHeight(); const FOOTER_HEIGHT=20;
        const currentDate = new Date().toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
        const expiryDate = new Date(); expiryDate.setDate(expiryDate.getDate()+1); const validUntil=expiryDate.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
        // Asegurar mapping
        prepareCartMapping();
        const storeEl = document.getElementById('storeFilter'); const storeId = storeEl ? (storeEl.value||'BA001GC') : 'BA001GC';
        const cartItems = (window.cart?.items||[]).map(x=>Object.assign({},x)); const cartClient = window.cart?.client? Object.assign({},window.cart.client): null; const cartCopy = { items: cartItems, client: cartClient };
        const addLogo = ()=> new Promise((res)=>{ const img=new Image(); img.crossOrigin='Anonymous'; img.onload=()=>{ const pw=doc.internal.pageSize.getWidth(); doc.addImage(img,'PNG', pw-55, 20, 50, 12); res(); }; img.onerror=()=>res(); img.src='/static/img/logo_0.png'; });
        const addFooter = ()=> new Promise((res)=>{ const img=new Image(); img.crossOrigin='Anonymous'; img.onload=()=>{ const pw=doc.internal.pageSize.getWidth(); const fw=pw-20; const fh=(img.height*fw)/img.width; const y=PAGE_HEIGHT - fh - 10; const pages=doc.internal.getNumberOfPages(); for(let i=1;i<=pages;i++){ doc.setPage(i); doc.addImage(img,'PNG',10,y,fw,fh);} res(fh); }; img.onerror=()=>res(FOOTER_HEIGHT); img.src='/static/img/pie.png'; });
        const checkPage=(y,need,fh)=>{ if (y+need > (PAGE_HEIGHT - fh - 10)){ doc.addPage(); return 10; } return y; };
        const addLines=(text,x,y,fh,opt={})=>{ const lh=doc.getLineHeight()/doc.internal.scaleFactor; const lines=doc.splitTextToSize(text, opt.maxWidth || (doc.internal.pageSize.getWidth()-x-10)); let cy=y; lines.forEach(line=>{ cy=checkPage(cy, lh, fh); doc.text(line, x, cy, opt); cy+=lh; }); return cy; };
        (async ()=>{
          await addLogo(); const fh = await addFooter(); const pw=doc.internal.pageSize.getWidth(); let y=10;
          doc.setFontSize(16); const titleW=doc.getTextWidth('Presupuesto'); y=checkPage(y,15,fh); doc.text('Presupuesto', pw/2 - titleW/2, y); y+=15;
          doc.setFontSize(8); y=checkPage(y,18,fh); doc.text(`Presupuesto Nro. ${window.lastQuotationNumber||'N/A'}`, 10, y); doc.text(`Fecha y Hora: ${currentDate}`,10,y+6); doc.text(`Válido hasta: ${validUntil}`,10,y+12); y+=18;
          // Dirección sucursal
          y=checkPage(y,10,fh); try { const r=await fetch(`/api/datos_tienda/${storeId}`); if(r.ok){ const d=await r.json(); const dir=d.direccion_completa_unidad_operativa||'Dirección no disponible'; doc.text(dir, pw-10, y, {align:'right'}); } } catch{}
          y+=10; doc.setFontSize(10); y=checkPage(y,25,fh); doc.text('Preparado para',10,y); doc.setFontSize(8);
          const clienteNombre = cartCopy.client?.nombre_cliente || cartCopy.client?.nombre || 'Consumidor Final';
          const clienteId = cartCopy.client?.numero_cliente || cartCopy.client?.id || 'N/A';
          const clienteIva = cartCopy.client?.tipo_contribuyente || 'N/A';
          doc.text(`Código de Cliente: ${clienteId}`,10,y+8); doc.text(`Nombre de Cliente: ${clienteNombre}`,10,y+14); doc.text(`Condición IVA: ${clienteIva}`,10,y+20); y+=25;
          // Tabla productos
          const head=[['Código','Descripción','Cantidad','U.M','Precio Unitario Lista','Precio Unitario con Desc.','Importe Total']];
          const body = cartCopy.items.map(item=>{
            const precioLista = convertirMonedaANumero(item.precioLista)||0; const precioDesc = convertirMonedaANumero(item.price)||0; const qty = parseFloat(item.quantity)||1; const total = precioDesc*qty;
            return [ item.productId||'N/A', item.productName||'Producto', {content: qty.toFixed(2).replace('.',','), styles:{halign:'right'}}, item.unidadMedida||'un', `$${formatearMoneda(precioLista)}`, `$${formatearMoneda(precioDesc)}`, `$${formatearMoneda(total)}` ];
          });
          doc.autoTable({ startY:y, head, body, theme:'grid', headStyles:{ fillColor:[180,185,199], textColor:[255,255,255], fontSize:7 }, bodyStyles:{ fontSize:8, lineHeight:1.1 }, columnStyles:{ 0:{cellWidth:25},1:{cellWidth:55, overflow:'linebreak'},2:{cellWidth:20, halign:'right'},3:{cellWidth:15, halign:'center'},4:{cellWidth:25, halign:'right'},5:{cellWidth:25, halign:'right'},6:{cellWidth:25, halign:'right'} }, styles:{ minCellHeight:8, cellPadding:1 }, margin:{ left:10, right:10, bottom: fh+10 }, pageBreak:'auto', didDrawPage:(data)=>{ const pageW=doc.internal.pageSize.getWidth(); const fw=pageW-20; const yF=PAGE_HEIGHT - fh - 10; const img=new Image(); img.src='/static/img/pie.png'; doc.addImage(img,'PNG',10,yF,fw,fh); } });
          // Forma de Pago (desde simulador)
          y = doc.lastAutoTable.finalY + 6; y = checkPage(y,8,fh);
          doc.setFontSize(10); y=addLines('Forma de Pago',10,y,fh); doc.setFontSize(8);
          try {
            const pagos = (typeof state !== 'undefined' && state?.carrito?.pagos && Array.isArray(state.carrito.pagos)) ? state.carrito.pagos : [];
            if (pagos.length) {
              let totalConInt = 0;
              pagos.forEach((p, i) => {
                const medio = (p.tipo || '').toString();
                const tarjeta = (p.tarjeta || '').toString();
                const cuotas = (p.cuotas != null ? `${p.cuotas} cuotas` : '').toString();
                const interes = (p.interes ? `int ${p.interes}%` : '');
                const ref = (p.referencia ? `Ref: ${p.referencia}` : '');
                const m = Number(p.monto||0) * (1 + Number(p.interes||0)/100);
                totalConInt += m;
                const parts = [medio, tarjeta, cuotas, interes].filter(Boolean).join(' ');
                y = addLines(`- ${parts} - $${formatearMoneda(m)} ${ref}`, 10, y, fh);
              });
              y = addLines(`Total (con intereses): $${formatearMoneda(totalConInt)}`, 10, y, fh);
            } else {
              const total = cartCopy.items.reduce((s,it)=>s + (convertirMonedaANumero(it.price)||0)*(parseFloat(it.quantity)||1), 0);
              y=addLines('Efectivo',10,y,fh);
              y=addLines(`${formatearMoneda(total)}`,10,y,fh);
            }
          } catch(_) {
            const total = cartCopy.items.reduce((s,it)=>s + (convertirMonedaANumero(it.price)||0)*(parseFloat(it.quantity)||1), 0);
            y=addLines('Efectivo',10,y,fh);
            y=addLines(`${formatearMoneda(total)}`,10,y,fh);
          }
          const blob=doc.output('blob'); const url=URL.createObjectURL(blob); const w=window.open(url); if(w){ w.onload=()=>{ w.print(); w.onfocus=()=>{ setTimeout(()=>{ URL.revokeObjectURL(url); try{ w.close(); }catch(_){ } },0); }; }; }
          resolve();
        })().catch(err=>{ console.error('generatePDF error', err); showToast('danger', `Error al generar el PDF: ${err.message}`); reject(err); });
      } catch(err){ reject(err); }
    });
  };

  // -------- generatePdfOnly (adaptado) --------
  window.generatePdfOnly = async function(){
    const sc = (typeof state !== 'undefined' && state?.carrito)
      ? state.carrito
      : ((window.state && window.state.carrito) ? window.state.carrito : { items:[] });
    if (!sc.items.length){ showToast('danger','El carrito está vacío.'); return; }
    // Mapear/cart globals
    prepareCartMapping();
    showSpinner();
    try {
      const idResp = await fetchWithAuth('/api/generate_pdf_quotation_id');
      window.lastQuotationNumber = idResp.quotation_id;
      const storeEl = document.getElementById('storeFilter'); const storeId = storeEl ? (storeEl.value||'BA001GC') : 'BA001GC';
      const quotationData = { quotation_id: window.lastQuotationNumber, type: 'local', store_id: storeId, client: window.cart.client || null, items: (window.cart.items||[]), observations: (window.cartObservations||''), timestamp: new Date().toISOString() };
      await fetchWithAuth('/api/save_local_quotation', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(quotationData) });
      await window.generatePDF();
      // Limpiar carrito POS
      try { sc.items = []; sc.descPorcentaje=0; sc.descMonto=0; sc.descMotivo=''; if (typeof renderCarrito==='function') renderCarrito(); if (typeof renderCatalogo==='function') renderCatalogo(); if (typeof save==='function') save(); } catch(_){}
      showToast('success', `PDF generado y presupuesto guardado con ID: ${window.lastQuotationNumber}`);
    } catch(error){ console.error('Error al generar PDF o guardar presupuesto:', error); showToast('danger', `Error: ${error.message}`);
    } finally { try { toggleCart(); } catch(_){} hideSpinner(); }
  };
})();
