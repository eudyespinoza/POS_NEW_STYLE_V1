/**
 * Funciones para el simulador de pagos
 */

let activeInput = null;

function setActiveAmountInput(el) {
    activeInput = el;
    el.select();
}

function parseNum(v) {
    const n = parseFloat((v || '').toString().replace(',', '.')) || 0;
    return Math.max(0, n);
}

function getSaldoRestante() {
    const total = parseNum(document.querySelector('[name="total_carrito"]').value);
    const importes = Array.from(document.querySelectorAll('input[name="importe_pago[]"]'))
        .map(i => parseNum(i.value));
    const pagado = importes.reduce((a, b) => a + b, 0);
    return total - pagado;
}

function applyChip(btn, pct) {
    const total = parseNum(document.querySelector('[name="total_carrito"]').value);
    if (!activeInput) {
        btn.closest('.row')?.querySelector('.amount-input')?.focus();
        return;
    }
    const valor = Math.floor(total * pct);
    activeInput.value = valor;
    const input = btn.closest('.row')?.querySelector('.amount-input');
    if (!input) return;
    activeInput = input;
    input.focus();
}

function applySaldo(btn) {
    const input = btn.closest('.row')?.querySelector('.amount-input');
    if (!input) return;
    activeInput = input;
    input.focus();
    const saldo = getSaldoRestante();
    const valor = Math.max(0, parseFloat(saldo.toFixed(2)));
    activeInput.value = valor.toFixed(2);
}

function keypad(key) {
    if (!activeInput) return;
    let v = activeInput.value?.toString() || "";
    if (key === '⌫') {
        activeInput.value = v.slice(0, -1);
        return;
    }
    if (key === ',00') {
        activeInput.value = (v || '0') + '00';
        return;
    }
    activeInput.value = v + key;
}

function applyEnter() {
    document.getElementById('form')?.requestSubmit();
}

document.getElementById('form')?.addEventListener('submit', (e) => {
    const total = parseNum(document.querySelector('[name="total_carrito"]').value);
    const importes = Array.from(document.querySelectorAll('input[name="importe_pago[]"]')).map(i => parseNum(i.value));
    let suma = importes.reduce((a, b) => a + b, 0);
    if (suma > total) {
        e.preventDefault();
        const last = document.querySelectorAll('input[name="importe_pago[]"]');
        const exceso = suma - total;
        const nuevo = Math.max(0, parseNum(last[last.length - 1].value) - exceso);
        const valorAjustado = parseFloat(nuevo.toFixed(2));
        last[last.length - 1].value = valorAjustado.toFixed(2);
        setTimeout(() => document.getElementById('form')?.requestSubmit(), 0);
    }
});

window.addEventListener('keydown', (ev) => {
    if (!activeInput) return;
    if (ev.key === 'Enter') { applyEnter(); }
    if (ev.key === '1') { applyChip(activeInput, 0.25); }
    if (ev.key === '2') { applyChip(activeInput, 0.50); }
    if (ev.key === '3') { applySaldo(activeInput); }
});

function agregarLinea() {
    const cont = document.getElementById('lineas');
    if (!cont) return;
    const block = cont.firstElementChild?.cloneNode(true);
    if (!block) return;
    block.querySelectorAll('input').forEach(i => i.value = '');
    block.querySelectorAll('select').forEach(sel => {
        sel.selectedIndex = 0;
        if (sel.classList.contains('cuotas-select')) {
            sel.setAttribute('disabled', '');
        }
    });
    cont.appendChild(block);
}

function eliminarLinea(btn) {
    const block = btn.closest('.border.rounded');
    block?.remove();
}

function toggleCuotas(sel) {
    const wrapper = sel.closest('.row');
    const cuotas = wrapper?.querySelector('.cuotas-select');
    if (!cuotas) return;
    if (sel.value === 'credito') {
        cuotas.removeAttribute('disabled');
    } else {
        cuotas.setAttribute('disabled', '');
        cuotas.value = '1';
    }
}

// Expose functions used in inline handlers
window.setActiveAmountInput = setActiveAmountInput;
window.applyChip = applyChip;
window.applySaldo = applySaldo;
window.keypad = keypad;
window.applyEnter = applyEnter;
window.agregarLinea = agregarLinea;
window.eliminarLinea = eliminarLinea;
window.toggleCuotas = toggleCuotas;
