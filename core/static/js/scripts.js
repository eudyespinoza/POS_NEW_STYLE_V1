﻿/***************************************
 * Archivo: app.js
 * DescripciÃ³n: GestiÃ³n de filtros, paginaciÃ³n,
 * visualizaciÃ³n de imÃ¡genes y carga dinÃ¡mica de productos
 * filtrados por StoreID.
 ***************************************/

// FunciÃ³n auxiliar para realizar solicitudes fetch con autenticaciÃ³n
async function fetchWithAuth(url, options = {}) {
    const defaultOptions = {
        credentials: 'include', // Incluir cookies de sesiÃ³n
        headers: {
            'X-Requested-With': 'XMLHttpRequest', // Identificar como AJAX
            ...options.headers
        }
    };
    const mergedOptions = { ...options, ...defaultOptions, headers: { ...defaultOptions.headers, ...options.headers } };

    try {
        const response = await fetch(url, mergedOptions);
        if (!response.ok) {
            if (response.status === 401) {
                console.warn("Usuario no autenticado, redirigiendo a login.");
                showToast('warning', 'Por favor, inicia sesiÃ³n para realizar esta acciÃ³n.');
                setTimeout(() => {
                    window.location.href = '/auth/login';
                }, 1500);
                throw new Error('Usuario no autenticado');
            }
            let errorData;
            try {
                errorData = await response.json();
                throw new Error(errorData.error || `Error en la solicitud: ${response.statusText}`);
            } catch (jsonError) {
                console.error("Respuesta no-JSON recibida:", response.status, response.statusText);
                throw new Error("Respuesta inesperada del servidor, posiblemente HTML. Contacta al administrador.");
            }
        }
        return await response.json();
    } catch (error) {
        console.error(`Error en fetchWithAuth (${url}):`, error);
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', () => {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const body = document.body;

  if (!themeToggleBtn) {
    console.warn('Elemento themeToggleBtn no encontrado; se omite cambio de tema.');
    return;
  }

  // Cargar tema guardado o predeterminado
  const savedTheme = localStorage.getItem('theme') || 'dark';
  // Mantener compatibilidad con estilos existentes y Bootstrap 5.3 theme
  body.classList.remove('light-mode','dark-mode');
  body.classList.add(savedTheme === 'dark' ? 'dark-mode' : 'light-mode');
  document.documentElement.setAttribute('data-bs-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // Evento de clic para cambiar tema
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = body.classList.contains('dark-mode') ? 'dark' : 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    // Actualizar clases heredadas
    body.classList.remove(`${currentTheme}-mode`);
    body.classList.add(`${newTheme}-mode`);
    // Actualizar atributo de Bootstrap
    document.documentElement.setAttribute('data-bs-theme', newTheme);
    // Persistir y actualizar icono
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  });

  function updateThemeIcon(theme) {
    themeToggleBtn.innerHTML = theme === 'light' ? '<i class="bi bi-moon-stars"></i>' : '<i class="bi bi-sun"></i>';
  }
});

/* Variables globales */
let products = [];         // Productos obtenidos desde el backend
let filteredProducts = []; // Productos filtrados (usados para paginaciÃ³n)
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let currentModalImageIndex = 0;
let currentModalProduct = null;
let hoverTimeout;          // Temporizador para evitar activaciones rÃ¡pidas
let overlayVisible = false; // Indicador para el estado del overlay
let isMouseOverImage = false; // Para controlar el overlay al pasar el mouse sobre la imagen
let cart = {
    items: [],
    client: null,
    quotation_id: null,
    type: 'new',
    observations: ''
}; // Array para almacenar los Ã­tems del carrito
let currentProductToAdd = null; // Producto seleccionado para agregar al carrito
let selectedClient = null;
let lastProductsUpdate = 0;
let cartObservations = "";
let db;
const DB_NAME = 'CartDB';
const DB_VERSION = 1;
const CART_STORE = 'carts';

function getLastStore() {
    if (typeof window.lastStore !== 'undefined' && window.lastStore) {
        return window.lastStore;
    }
    if (typeof lastStore !== 'undefined' && lastStore) {
        return lastStore;
    }
    const el = document.getElementById('backend-last-store-data');
    if (el) {
        try {
            const parsed = JSON.parse(el.textContent || 'null');
            if (parsed) {
                return parsed;
            }
        } catch (e) {
            console.warn('No se pudo parsear backend-last-store-data:', e);
        }
    }
    return 'BA001GC';
}

async function checkProductsUpdate() {
    try {
        const data = await fetchWithAuth('/api/check_products_update');
        const newLastModified = data.last_modified;

        if (newLastModified > lastProductsUpdate) {
            lastProductsUpdate = newLastModified;
            const storeId = document.getElementById("storeFilter").value || getLastStore();
            await loadProducts(storeId, 1, 20000, false, false);
        }
    } catch (error) {
        console.error("Error al verificar actualizaciÃ³n de productos:", error);
        showToast('danger', 'Error al verificar actualizaciÃ³n de productos.');
    }
}

/***************************************
 * Cambio de Vista: Tabla â†” Cards
 ***************************************/
function cambiarVista(vista) {
    const tableView = document.getElementById("tableView");
    const cardView = document.getElementById("cardView");
    const btnTableView = document.getElementById("btnTableView");
    const btnCardView = document.getElementById("btnCardView");

    if (!tableView || !cardView || !btnTableView || !btnCardView) {
        console.error("âŒ Error: Elementos del DOM no encontrados.");
        return;
    }

    if (vista === "tabla") {
        tableView.classList.remove("d-none");
        cardView.classList.add("d-none");
        btnTableView.classList.add("active");
        btnCardView.classList.remove("active");
    } else {
        tableView.classList.add("d-none");
        cardView.classList.remove("d-none");
        btnCardView.classList.add("active");
        btnTableView.classList.remove("active");
    }

    displayProducts(filteredProducts);
}

/***************************************
 * Generar Vista en Cards
 ***************************************/
function cargarVistaCards(productos) {
  const cardView = document.getElementById("cardView");

  if (!cardView) {
    console.error("âŒ Error: No se encontrÃ³ el contenedor de cards (`cardView`).");
    return;
  }

  cardView.innerHTML = "";

  if (!productos.length) {
    cardView.innerHTML = `<p class="text-center text-danger">No se encontraron productos.</p>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const product of productos) {
    const cardWrapper = document.createElement("div");
    cardWrapper.className = "col-lg-2 col-md-3 col-sm-6 col-12 mb-3";

    const card = document.createElement("div");
    card.className = "card small-card shadow-sm";
    card.setAttribute("data-product-id", product.numero_producto);

    card.innerHTML = `
      <div class="image-container">
        <div class="spinner-border spinner-border-sm text-primary image-spinner" role="status">
          <span class="visually-hidden">Cargando...</span>
        </div>
        <img data-src="/static/img/placeholder.jpg" 
             alt="${product.nombre_producto}" 
             class="card-img-top product-image lazyload"
             onclick="event.stopPropagation(); showModal(${product.numero_producto}, 1)">
      </div>
      <div class="card-body text-center p-2"> 
        <h6 class="card-title">${product.numero_producto} | ${product.nombre_producto}</h6>
        <p class="card-text"><strong>$${product.precio_final_con_iva}</strong></p>
        <p class="card-text"><strong><span class="text-success">$${product.precio_final_con_descuento}</span></strong></p>
        <p class="card-text coverage-group">${product.grupo_cobertura}</p>
        <button class="btn btn-sm btn-outline-primary btn-stock mt-1"
                onclick="event.stopPropagation(); buscarStock(event, '${product.nombre_producto}', '${product.numero_producto}', '${product.unidad_medida}')">
          <i class="bi bi-box-seam"></i> Stock
        </button>
        <button class="btn btn-sm btn-success btn-cart mt-1"
                onclick="showQuantityModal(event, '${product.numero_producto}', '${product.nombre_producto}', '${product.precio_final_con_descuento}')">
          <i class="bi bi-cart-plus"></i>
        </button>
      </div>
    `;

    cardWrapper.appendChild(card);
    fragment.appendChild(cardWrapper);
  }

  cardView.appendChild(fragment);
  setupCardListeners();
  cargarImagenesCards(productos);
}

async function cargarImagenesCards(productos) {
    for (const product of productos) {
        const card = document.querySelector(`.card[data-product-id="${product.numero_producto}"]`);
        if (card) {
            const imageUrl = await obtenerImagenProducto(product.numero_producto);
            const img = card.querySelector(".product-image");
            img.setAttribute("data-src", imageUrl);
        }
    }
    initLazyLoading(); // Activar lazy loading despuÃ©s de actualizar data-src
}

/***************************************
 * Obtener Imagen del Producto (Usando CachÃ©)
 ***************************************/
async function obtenerImagenProducto(productId) {
    const defaultImage = "/static/img/default.jpg";
    const cacheKey = `img_cache_${productId}`;
    const cachedImage = sessionStorage.getItem(cacheKey);

    if (cachedImage) {
        return cachedImage;
    }

    const imageChecks = [1, 2, 3].map(i => ({
        url: getImageUrl(productId, i),
        index: i
    }));

    const results = await Promise.all(
        imageChecks.map(check =>
            imageExists(check.url, productId, check.index)
                .then(exists => ({ url: check.url, exists }))
        )
    );

    const firstValidImage = results.find(result => result.exists)?.url;
    const finalImage = firstValidImage || defaultImage;

    sessionStorage.setItem(cacheKey, finalImage);
    return finalImage;
}

/***************************************
 * Funciones Utilitarias y de Imagen
 ***************************************/
function getImageUrl(productId, index) {
  return `https://productimages.familiabercomat.com/medium/${productId}_000_00${index}.jpg`;
}

async function imageExists(url, productId, index) {
  const cacheKey = `img_cache_${productId}_${index}`;
  const cachedResult = localStorage.getItem(cacheKey);
  if (cachedResult !== null) {
    return cachedResult === 'true';
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      localStorage.setItem(cacheKey, 'true');
      resolve(true);
    };
    img.onerror = () => {
      localStorage.setItem(cacheKey, 'false');
      resolve(false);
    };
    img.src = url;
  });
}

/***************************************
 * Funciones para Modal y Overlay
 ***************************************/
async function showModal(productId) {
    currentModalProduct = productId;

    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const modalContent = document.querySelector('.image-modal-content');

    // ðŸ”¹ Determinar quÃ© imÃ¡genes existen para este producto
    let availableImages = [];
    for (let i = 1; i <= 3; i++) {
        const imageUrl = getImageUrl(productId, i);
        const cacheKey = `img_cache_${productId}_${i}`;
        let exists = localStorage.getItem(cacheKey);

        if (exists === null) {
            exists = await imageExists(imageUrl, productId, i);
        } else {
            exists = exists === 'true'; // Convertir string a booleano
        }

        if (exists) {
            availableImages.push(imageUrl);
        }
    }

    // ðŸ”¹ Si no hay imÃ¡genes disponibles, usar la imagen por defecto
    if (availableImages.length === 0) {
        availableImages.push("/static/img/default.jpg");
    }

    currentModalImageIndex = 0; // Siempre empezamos con la primera imagen disponible
    modalImg.src = availableImages[currentModalImageIndex];
    ajustarImagenModal();
    modal.style.display = 'flex';

    // Guardamos las imÃ¡genes disponibles en un dataset para navegaciÃ³n
    modal.dataset.availableImages = JSON.stringify(availableImages);

    // Elimina botones previos para evitar duplicados
    document.getElementById('modalPrevButton')?.remove();
    document.getElementById('modalNextButton')?.remove();

    // ðŸ”¹ Crear botÃ³n "Anterior"
    if (availableImages.length > 1) {
        const prevButton = document.createElement('button');
        prevButton.id = 'modalPrevButton';
        prevButton.classList.add('modal-nav-button', 'btn', 'btn-dark');
        prevButton.innerHTML = 'â®';
        prevButton.onclick = (event) => {
            event.stopPropagation();
            navigateModalImage(-1);
        };
        modalContent.appendChild(prevButton);
    }

    // ðŸ”¹ Crear botÃ³n "Siguiente"
    if (availableImages.length > 1) {
        const nextButton = document.createElement('button');
        nextButton.id = 'modalNextButton';
        nextButton.classList.add('modal-nav-button', 'btn', 'btn-dark');
        nextButton.innerHTML = 'â¯';
        nextButton.onclick = (event) => {
            event.stopPropagation();
            navigateModalImage(1);
        };
        modalContent.appendChild(nextButton);
    }
}

function closeModal() {
    document.getElementById('imageModal').style.display = 'none';
}

function navigateModalImage(direction) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    let availableImages = JSON.parse(modal.dataset.availableImages); // Recuperamos imÃ¡genes disponibles

    currentModalImageIndex += direction;

    // ðŸ”¹ Evitar desbordamiento de Ã­ndice
    if (currentModalImageIndex < 0) {
        currentModalImageIndex = availableImages.length - 1;
    } else if (currentModalImageIndex >= availableImages.length) {
        currentModalImageIndex = 0;
    }

    modalImg.src = availableImages[currentModalImageIndex];
}

function updateModalNavButtons() {
  // AquÃ­ podrÃ­as actualizar el estado de los botones segÃºn el Ã­ndice actual
  // Por ejemplo, deshabilitar "prev" si currentModalImageIndex === 0, etc.
}

function closeOverlay() {
  const overlay = document.getElementById('productOverlay');
  const overlayContent = document.getElementById('overlayContent');

  if (overlay && overlayContent) {
    overlayContent.innerHTML = '';
    overlay.classList.add('d-none');
    overlayVisible = false;
  }
}

function ajustarAnchoModal() {
    const tabla = document.querySelector("#tableView");
    const cards = document.querySelector("#cardView");
    const overlayContent = document.getElementById("overlayContent");

    if (!overlayContent) return;

    let nuevoAncho = "90vw"; // ðŸ”¹ Valor por defecto

    // ðŸ”¹ Si la tabla estÃ¡ visible, tomamos su ancho
    if (!tabla.classList.contains("d-none")) {
        nuevoAncho = `${tabla.offsetWidth}px`;
    }

    // ðŸ”¹ Si las cards estÃ¡n activas, ajustamos a su contenedor
    if (!cards.classList.contains("d-none")) {
        nuevoAncho = `${cards.offsetWidth}px`; // Ajustamos un poco mÃ¡s pequeÃ±o si es necesario
    }

    // Aplicamos el ancho calculado
    overlayContent.style.width = nuevoAncho;
}

/***************************************
 * Funciones para imÃ¡genes de producto
 ***************************************/
async function generateImageHtml(productId) {
    const imageUrl = getImageUrl(productId, 1);
    const exists = await imageExists(imageUrl, productId, 1);
    if (exists) {
        return `
            <div class="product-image-container" data-current-index="1">
                <img 
                    src="${imageUrl}" 
                    class="product-image img-thumbnail"
                    onclick="event.stopPropagation(); showModal(${productId}, parseInt(this.parentElement.dataset.currentIndex))"
                    alt="Producto ${productId}"
                >
                <div class="image-nav-buttons">
                    <button class="image-nav-button prev-image" 
                            onclick="event.stopPropagation(); navigateImage(${productId}, this.parentElement.parentElement, -1)" 
                            disabled>
                        â†
                    </button>
                    <button class="image-nav-button next-image" 
                            onclick="event.stopPropagation(); navigateImage(${productId}, this.parentElement.parentElement, 1)">
                        â†’
                    </button>
                </div>
            </div>
        `;
    }
    return 'Sin imagen';
}

async function navigateImage(productId, container, direction) {
  const currentIndex = parseInt(container.dataset.currentIndex);
  const newIndex = currentIndex + direction;
  if (newIndex >= 1 && newIndex <= 3) {
    const newUrl = getImageUrl(productId, newIndex);
    const exists = await imageExists(newUrl, productId, newIndex);
    if (exists) {
      const img = container.querySelector('.product-image');
      img.src = newUrl;
      container.dataset.currentIndex = newIndex;
      const prevButton = container.querySelector('.prev-image');
      const nextButton = container.querySelector('.next-image');
      prevButton.disabled = newIndex === 1;
      const nextImageExists = newIndex < 3
        ? await imageExists(getImageUrl(productId, newIndex + 1), productId, newIndex + 1)
        : false;
      nextButton.disabled = !nextImageExists;
    }
  }
}

/***************************************
 * Funciones de PaginaciÃ³n y VisualizaciÃ³n
 ***************************************/
async function displayProducts(products) {
    const productList = document.getElementById("productList");
    const cardView = document.getElementById("cardView");

    if (!productList || !cardView) {
        return;
    }

    productList.innerHTML = "";
    cardView.innerHTML = "";

    if (!products || !Array.isArray(products) || products.length === 0) {
        console.log("No hay productos para mostrar.");
        mostrarMensaje("No hay productos disponibles.");
        productList.innerHTML = `<tr><td colspan="11" class="text-center text-danger">No se encontraron productos.</td></tr>`;
        cardView.innerHTML = `<p class="text-center text-danger">No se encontraron productos.</p>`;
        updatePagination(0);
        return;
    }

    const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);
    if (currentPage > totalPages) {
        currentPage = totalPages || 1;
    }

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageProducts = products.slice(startIndex, endIndex);

    const isTableView = !document.getElementById("tableView")?.classList.contains("d-none");

    if (isTableView) {
        const fragment = document.createDocumentFragment();
        for (const product of pageProducts) {
            const row = document.createElement("tr");
            row.dataset.productId = product["numero_producto"];
            row.innerHTML = `
                <td><strong>${product["numero_producto"]}</strong></td>
                <td>${product["categoria_producto"]}</td>
                <td>${product["nombre_producto"]}</td>
                <td>${product["grupo_cobertura"]}</td>
                <td>${product["unidad_medida"]}</td>
                <td>${product["precio_final_con_iva"]}</td>
                <td><strong><span class="text-success">$${product["precio_final_con_descuento"]}</span></strong></td>
                <td>${product["store_number"]}</td>
                <td id="images-${product["numero_producto"]}">
                    <div class="image-container">
                        <div class="spinner-border spinner-border-sm text-primary image-spinner" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                        <img data-src="/static/img/placeholder.jpg" class="product-image img-thumbnail lazyload" alt="Cargando...">
                    </div>
                </td>
                <td>
                    <button class="btn btn-primary btn-sm btn-stock" 
                            onclick="buscarStock(event, '${product["nombre_producto"]}', '${product["numero_producto"]}', '${product["unidad_medida"]}')">
                        <i class="bi bi-box-seam"></i>
                    </button>
                </td>
                <td>
                    <button class="btn btn-success btn-cart btn-md" 
                            onclick="showQuantityModal(event, '${product["numero_producto"]}', '${product["nombre_producto"]}', '${product["precio_final_con_descuento"]}')">
                        <i class="bi bi-cart-plus"></i>
                    </button>
                </td>
            `;
            fragment.appendChild(row);
        }
        productList.appendChild(fragment);
        setupRowListeners();
        cargarImagenesTabla(pageProducts);
    } else {
        cargarVistaCards(pageProducts);
    }

    updatePagination(products.length);
}

async function cargarImagenesTabla(products) {
    for (const product of products) {
        const imageCell = document.getElementById(`images-${product["numero_producto"]}`);
        if (imageCell) {
            const imageUrl = await obtenerImagenProducto(product["numero_producto"]);
            const img = imageCell.querySelector("img");
            img.setAttribute("data-src", imageUrl);
            img.setAttribute("onclick", `showModal(${product["numero_producto"]}, 1)`);
            img.alt = `Producto ${product["numero_producto"]}`;
        }
    }
    initLazyLoading(); // Activar lazy loading despuÃ©s de actualizar data-src
}


// FunciÃ³n para mostrar un mensaje en la interfaz de usuario
function mostrarMensaje(mensaje) {
    const mensajeElement = document.getElementById("mensaje");
    if (mensajeElement) {
        mensajeElement.textContent = mensaje;
        mensajeElement.classList.remove("d-none"); // AsegÃºrate de que el mensaje sea visible
    }
}

function changePage(page) {
    if (page >= 1 && page <= Math.ceil(filteredProducts.length / ITEMS_PER_PAGE)) {
        currentPage = page;
        displayProducts(filteredProducts); // Actualizar la vista con los productos filtrados
    }
}

async function actualizarTabla(productos) {
    const productList = document.getElementById("productList");
    if (!productList) return;
    productList.innerHTML = ""; // ðŸ”¹ Limpiar tabla antes de insertar

    if (!productos.length) {
        productList.innerHTML = `<tr>
            <td colspan="10" class="text-center text-danger">No se encontraron productos.</td>
        </tr>`;
        return;
    }

    for (const product of productos) {
        const row = document.createElement("tr");
        row.dataset.productId = product.numero_producto; // ðŸ”¹ Guardar ID del producto en la fila

        // Obtener imagen
        const imageUrl = await obtenerImagenProducto(product.numero_producto);

        row.innerHTML = `
            <td><strong>${product.numero_producto}</strong></td>
            <td>${product.categoria_producto}</td>
            <td>${product.nombre_producto}</td>
            <td>${product.grupo_cobertura}</td>
            <td>${product.unidad_medida}</td>
            <td>${product.precio_final_con_iva}</td>
            <td><strong><span class="text-success">$${product.precio_final_con_descuento}</span></strong></td>
            <td>${product.store_number}</td>
            <td>
                <img data-src="${imageUrl}" class="product-image img-thumbnail lazyload"
                     alt="Producto ${product.numero_producto}" 
                     onclick="showModal(${product.numero_producto}, 1)">
            </td>
            <td>
                <button class="btn btn-primary btn-sm btn-stock" 
                        onclick="buscarStock(event, '${product.nombre_producto}', '${product.numero_producto}', '${product.unidad_medida}')">
                    <i class="bi bi-box-seam"></i> Stock
                </button>
            </td>
        `;

        productList.appendChild(row);
    }

    // ðŸ”¹ Llamar a setupRowListeners() despuÃ©s de agregar las filas
    setupRowListeners();
    setTimeout(initLazyLoading, 100);
}

function updatePagination(totalItems) {
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const pagination = document.getElementById('pagination');
  if (!pagination) return;

  pagination.innerHTML = "";
  const ul = document.createElement("ul");
  ul.classList.add("pagination", "justify-content-center");

  // BotÃ³n "Anterior"
  const prevItem = document.createElement("li");
  prevItem.classList.add("page-item");
  if (currentPage === 1) prevItem.classList.add("disabled");
  const prevLink = document.createElement("a");
  prevLink.classList.add("page-link");
  prevLink.href = "#";
  prevLink.innerHTML = `<i class="bi bi-chevron-left"></i>`;
  prevLink.onclick = (e) => {
    e.preventDefault();
    changePage(currentPage - 1);
  };
  prevItem.appendChild(prevLink);
  ul.appendChild(prevItem);

  // Botones numerados
  const maxPagesToShow = 7;
  const halfRange = Math.floor(maxPagesToShow / 2);
  let start = Math.max(1, currentPage - halfRange);
  let end = Math.min(totalPages, currentPage + halfRange);
  if (start > 1) {
    ul.appendChild(createPageItem(1));
    if (start > 2) ul.appendChild(createDotsItem());
  }
  for (let i = start; i <= end; i++) {
    ul.appendChild(createPageItem(i));
  }
  if (end < totalPages) {
    if (end < totalPages - 1) ul.appendChild(createDotsItem());
    ul.appendChild(createPageItem(totalPages));
  }

  // BotÃ³n "Siguiente"
  const nextItem = document.createElement("li");
  nextItem.classList.add("page-item");
  if (currentPage === totalPages) nextItem.classList.add("disabled");
  const nextLink = document.createElement("a");
  nextLink.classList.add("page-link");
  nextLink.href = "#";
  nextLink.innerHTML = `<i class="bi bi-chevron-right"></i>`;
  nextLink.onclick = (e) => {
    e.preventDefault();
    changePage(currentPage + 1);
  };
  nextItem.appendChild(nextLink);
  ul.appendChild(nextItem);

  pagination.appendChild(ul);
}

function createPageItem(page) {
  const li = document.createElement("li");
  li.classList.add("page-item");
  if (page === currentPage) li.classList.add("active");
  const link = document.createElement("a");
  link.classList.add("page-link");
  link.href = "#";
  link.textContent = page;
  link.onclick = (e) => {
    e.preventDefault();
    changePage(page);
  };
  li.appendChild(link);
  return li;
}

function createDotsItem() {
  const li = document.createElement("li");
  li.classList.add("page-item", "disabled");
  const span = document.createElement("span");
  span.classList.add("page-link");
  span.textContent = "...";
  li.appendChild(span);
  return li;
}

function normalizeText(text = "") {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function filterProducts() {
    const searchField = document.getElementById('search');
    const searchTerms = searchField ? searchField.value
        .trim()
        .toLowerCase()
        .split(' ')
        .filter(term => term.length > 0) : [];

    const category = document.getElementById("categoryFilter")?.value || "";
    const coverage = document.getElementById("coverageGroupFilter")?.value || ""; // normalizado
    const store = document.getElementById("storeFilter")?.value || getLastStore();
    const excludeSpecial = document.getElementById("excludeSpecialCategories")?.checked || false;
    const minPrice = parseFloat(document.getElementById("minPrice")?.value) || 0;
    const maxPrice = parseFloat(document.getElementById("maxPrice")?.value) || Infinity;

    // Nuevos filtros de stock
    const signoMas = document.getElementById("signoMas")?.checked;
    const signoMenos = document.getElementById("signoMenos")?.checked;
    const signoCero = document.getElementById("cero")?.checked;

    const excludeWords = ["outlet", "outle", "2da", "saldo", "lote", "@", "//", "pedido", "outl"];

    if (!products || !Array.isArray(products)) {
        throw new Error("La lista de productos no estÃ¡ definida o no es vÃ¡lida.");
    }

    let filtered = products.filter(product => {
        const productName = product["nombre_producto_normalizado"] || "";
        const productNumber = product["numero_producto"] ? String(product["numero_producto"]) : "";
        const productSigno = product["signo"] || "0"; // Asumimos "0" si no existe el campo

        const matchesSearch = searchTerms.length === 0 || searchTerms.every(term =>
            productName.includes(term) || productNumber.includes(term)
        );

        const matchesCategory = !category || product["categoria_producto"] === category;
        const matchesCoverage = !coverage || (product["grupo_cobertura_normalizado"] === coverage);
        const matchesStore = !store || product["store_number"] === store;

        const productPrice = parseFloat(product["precio_final_con_descuento"]?.replace(/\./g, "").replace(",", ".")) || 0;
        const matchesPrice = productPrice >= minPrice && productPrice <= maxPrice;

        const excludeSpecialFilter = excludeSpecial
            ? !excludeWords.some(word =>
                productName.includes(word) ||
                productName.startsWith(word) ||
                productName.endsWith(word)
            )
            : true;

        // Filtro por signo
        const matchesSigno =
            (signoMas && productSigno === "+") ||
            (signoMenos && productSigno === "-") ||
            (signoCero && productSigno === "0");

        return matchesSearch && matchesCategory && matchesCoverage && matchesStore && matchesPrice && excludeSpecialFilter && matchesSigno;
    });

    // Ordenar alfabÃ©ticamente por nombre_producto
    filtered.sort((a, b) => {
        const nameA = a.nombre_producto?.toLowerCase() || "";
        const nameB = b.nombre_producto?.toLowerCase() || "";
        return nameA.localeCompare(nameB);
    });

    return filtered;
}

function filterAndPaginate(withSpinner = false, resetPage = true) {
    if (withSpinner) showSpinner();
    if (resetPage) {
        currentPage = 1;
    }
    const productListEl = document.getElementById("productList");
    const cardViewEl = document.getElementById("cardView");
    if (productListEl) productListEl.innerHTML = "";
    if (cardViewEl) cardViewEl.innerHTML = "";
    filteredProducts = [];
    try {
        filteredProducts = filterProducts();
        displayProducts(filteredProducts);
    } catch (error) {
        console.error("Error en filterAndPaginate:", error);
        filteredProducts = [];
        if (productListEl) productListEl.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error al filtrar productos. Intenta de nuevo.</td></tr>`;
        if (cardViewEl) cardViewEl.innerHTML = `<p class="text-center text-danger">Error al filtrar productos. Intenta de nuevo.</p>`;
        updatePagination(0);
    }
    if (withSpinner) hideSpinner();
}

function clearFilters() {
    const search = document.getElementById('search');
    if (search) search.value = '';
    const category = document.getElementById('categoryFilter');
    if (category) category.value = '';
    const coverage = document.getElementById('coverageGroupFilter');
    if (coverage) coverage.value = '';
    const exclude = document.getElementById('excludeSpecialCategories');
    if (exclude) exclude.checked = true;
    const priceRange = document.getElementById("priceRangeFilter");
    if (priceRange) priceRange.value = "";
    const minPriceEl = document.getElementById("minPrice");
    if (minPriceEl) minPriceEl.value = "";
    const maxPriceEl = document.getElementById("maxPrice");
    if (maxPriceEl) maxPriceEl.value = "";
    // Reiniciar filtros de stock
    const signoMasEl = document.getElementById("signoMas");
    if (signoMasEl) signoMasEl.checked = true;
    const signoMenosEl = document.getElementById("signoMenos");
    if (signoMenosEl) signoMenosEl.checked = true;
    const signoCeroEl = document.getElementById("cero");
    if (signoCeroEl) signoCeroEl.checked = true;

    currentPage = 1;
    filterAndPaginate();
}

function sortTable(columnIndex) {
  const table = document.getElementById('productTable');
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const headers = table.querySelectorAll('th');
  if (!rows.length) {
    console.warn("No hay productos para ordenar.");
    return;
  }
  const currentDirection = headers[columnIndex].getAttribute('data-sort') === 'asc' ? 'desc' : 'asc';
  headers.forEach(header => header.removeAttribute('data-sort'));
  headers[columnIndex].setAttribute('data-sort', currentDirection);

  rows.sort((a, b) => {
    const aValue = a.cells[columnIndex].textContent.trim();
    const bValue = b.cells[columnIndex].textContent.trim();
    if (!isNaN(aValue) && !isNaN(bValue)) {
      return currentDirection === 'asc'
        ? parseFloat(aValue) - parseFloat(bValue)
        : parseFloat(bValue) - parseFloat(aValue);
    } else {
      return currentDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }
  });
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(row => tbody.appendChild(row));
}

/***************************************
 * Funciones para inicializar filtros
 ***************************************/
function initializeFilters(previousCategory = "", previousCoverageNorm = "") {
  // Recolectar categorÃ­as y grupos de cobertura a partir de los productos actuales
  const categories = new Set();
  const coverageGroupMap = new Map(); // normalizado -> etiqueta original

  products.forEach(product => {
    if (product["categoria_producto"]) categories.add(product["categoria_producto"]);
    const label = product["grupo_cobertura"] || "";
    const value = product["grupo_cobertura_normalizado"] || normalizeText(label);
    if (value && !coverageGroupMap.has(value)) coverageGroupMap.set(value, label);
  });

  // Repoblar los filtros, conservando el valor previamente seleccionado si existe
  populateFilter("categoryFilter", Array.from(categories), false, previousCategory);
  const coverageOptions = Array.from(coverageGroupMap.entries()).map(([value, label]) => ({ value, label }));
  populateFilter("coverageGroupFilter", coverageOptions, false, previousCoverageNorm);

  // Para el filtro de tiendas, se carga sÃ³lo en la carga inicial (usando la variable global backendStores)
  const storeFilterElement = document.getElementById("storeFilter");
  if (storeFilterElement && storeFilterElement.options.length === 0) {
    const storeSet = new Set(backendStores);
    populateFilter("storeFilter", Array.from(storeSet), true);
  }
}

function populateFilter(filterId, values, isStoreFilter = false, selectedValue = "") {
  const filterElement = document.getElementById(filterId);
  if (!filterElement) {
    console.error(`No se encontrÃ³ el filtro con ID: ${filterId}`);
    return;
  }

  // Para filtros que no sean de tienda, reiniciamos las opciones
  if (!isStoreFilter) {
    filterElement.innerHTML = '';
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Todos";
    filterElement.appendChild(defaultOption);
  }

  const isObjectList = Array.isArray(values) && values.length && typeof values[0] === 'object';
  const sortedValues = Array.from(values).sort((a, b) => {
    const la = isObjectList ? (a.label || '') : (a || '');
    const lb = isObjectList ? (b.label || '') : (b || '');
    return la.localeCompare(lb);
  });

  sortedValues.forEach(v => {
    const value = isObjectList ? v.value : v;
    const label = isObjectList ? (v.label ?? v.value) : v;
    if (label) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      filterElement.appendChild(option);
    }
  });

  // Si se proporcionÃ³ un valor seleccionado, se intenta restablecer
  if (selectedValue) {
    for (let i = 0; i < filterElement.options.length; i++) {
      if (filterElement.options[i].value === selectedValue) {
        filterElement.value = selectedValue;
        break;
      }
    }
  } else if (isStoreFilter && filterElement.options.length > 0 && !filterElement.value) {
    // Seleccionar el primero si no hay valor actual para tienda
    const first = isObjectList ? (sortedValues[0]?.value || '') : (sortedValues[0] || '');
    filterElement.value = first;
  }
}

/***************************************
 * FunciÃ³n para cargar productos desde el backend
 ***************************************/
async function loadProducts(storeId, page = 1, itemsPerPage = 20000, showSpinnerParam = true, resetPage = true) {
    let spinnerShown = false;
    try {
        if (showSpinnerParam) {
            showSpinner();
            spinnerShown = true;
        }
        const response = await fetch(`/api/productos?store=${storeId}&page=${page}&items_per_page=${itemsPerPage}`);
        if (!response.ok) {
            throw new Error("Error al cargar productos");
        }
        const rawProducts = await response.json();
        products = rawProducts.map(product => ({
            ...product,
            nombre_producto_normalizado: normalizeText(product["nombre_producto"] || ""),
            grupo_cobertura_normalizado: normalizeText(product["grupo_cobertura"] || "")
        }));
        // Actualizar filtro de tienda...
        const storeFilterElement = document.getElementById("storeFilter");
        if (storeFilterElement && storeFilterElement.value !== storeId) {
            storeFilterElement.value = storeId;
        }
        // Conservar valores previos de filtros...
        const catEl = document.getElementById("categoryFilter");
        const covEl = document.getElementById("coverageGroupFilter");
        const previousCategory = catEl ? catEl.value : "";
        const previousCoverage = covEl ? covEl.value : "";
        const previousCoverageNorm = previousCoverage ? normalizeText(previousCoverage) : "";
        // Reiniciar filtros...
        initializeFilters(previousCategory, previousCoverageNorm);
        if (resetPage) {
            currentPage = 1;
        }
        filterAndPaginate(false, resetPage);
        // Actualizar precios en el carrito...
        updateCartPrices(storeId);
        // Actualizar lastProductsUpdate...
        const updateResponse = await fetch('/api/check_products_update');
        if (updateResponse.ok) {
            const updateData = await updateResponse.json();
            lastProductsUpdate = updateData.last_modified;
        }
    } catch (error) {
        console.error("Error al cargar productos:", error);
        showToast('danger', 'Error al cargar productos');
    } finally {
        if (spinnerShown) {
            hideSpinner();
        }
    }
}

/***************************************
 * Event Listeners
 ***************************************/
  document.addEventListener("DOMContentLoaded", function () {
    showSpinner();
    const initialStore = getLastStore();
    loadProducts(initialStore);

    const storeFilterElement = document.getElementById('storeFilter');
    if (storeFilterElement) {
        storeFilterElement.value = initialStore;
        storeFilterElement.addEventListener('change', function() {
            const selectedStore = this.value;
            loadProducts(selectedStore);
            updateLastStore(selectedStore);
            window.lastStore = selectedStore;
        });
    }

    // Configurar polling cada 5 minutos (300,000 ms)
    setInterval(checkProductsUpdate, 300000);

    let debounceTimeout;
    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const busqueda = searchInput.value;
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                if (busqueda.length >= 3 || busqueda.length === 0) {
                    filterAndPaginate(false);
                }
            }, 300);
        });
    }

    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) categoryFilter.addEventListener('change', filterAndPaginate);
    const coverageGroupFilter = document.getElementById('coverageGroupFilter');
    if (coverageGroupFilter) coverageGroupFilter.addEventListener('change', filterAndPaginate);
    const excludeSpecialCategories = document.getElementById('excludeSpecialCategories');
    if (excludeSpecialCategories) excludeSpecialCategories.addEventListener('change', filterAndPaginate);
});

// InicializaciÃ³n de toasts de Bootstrap (si aplica)
document.addEventListener('DOMContentLoaded', function () {
  const toastElements = document.querySelectorAll('.toast');
  toastElements.forEach(function (toastElement) {
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
  });
});

// FunciÃ³n opcional para limpiar cachÃ© de imÃ¡genes
function clearImageCache() {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('img_cache_')) {
      localStorage.removeItem(key);
    }
  });
}

async function updateLastStore(storeId) {
    try {
        const response = await fetch('/api/update_last_store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_id: storeId })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al actualizar last_store');
        }
    } catch (error) {
        console.error("Error al actualizar last_store:", error);
        showToast('danger', `Error al actualizar la Ãºltima tienda: ${error.message}`);
    }
}

let spinnerActive = false; // bandera global

function showSpinner() {
  if (spinnerActive) return;  // Si ya estÃ¡ activo, no hace nada
  spinnerActive = true;
  const spinner = document.getElementById('spinner');
  if (spinner) {
    spinner.style.display = 'flex'; // Usamos 'flex' para centrar (con align-items/justify-content)
  }
}

function hideSpinner() {
  if (!spinnerActive) return; // Evitamos ocultarlo si no estÃ¡ activo
  spinnerActive = false;
  const spinner = document.getElementById('spinner');
  if (spinner) {
    spinner.style.display = 'none';
  }
}

async function buscarStock(event, productoNombre, productoId, unidadMedida, storeId) {
    try {
        event.stopPropagation();
        showSpinner();

        if (!productoId) {
            console.error("âš ï¸ Error: productoId no vÃ¡lido en buscarStock()");
            alert("Error: Producto no vÃ¡lido.");
            return;
        }

        const effectiveStoreId = storeId || document.getElementById("storeFilter").value || "BA001GC";
        const url = `/api/stock/${encodeURIComponent(productoId)}/${encodeURIComponent(effectiveStoreId)}`;

        const stockResp = await fetch(url);

        if (!stockResp.ok) {
            if (stockResp.status === 404) {
                abrirOverlayStock(productoNombre, productoId, unidadMedida, null, "No hay stock disponible para este producto en la tienda seleccionada.");
                return;
            }
            throw new Error("Error al obtener stock del producto");
        }

        const stockData = await stockResp.json();
        abrirOverlayStock(productoNombre, productoId, unidadMedida, stockData);
    } catch (error) {
        console.error("âŒ Error al buscar stock:", error);
        abrirOverlayStock(productoNombre, productoId, unidadMedida, null, "OcurriÃ³ un error al buscar el stock.");
    } finally {
        hideSpinner();
    }
}

function convertirMonedaANumero(valor) {
  if (valor === null || valor === undefined) return 0;

  // Si ya es nÃºmero, devolverlo redondeado
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return parseFloat(valor.toFixed(2));
  }

  try {
    let s = valor.toString().trim();

    // Normalizar "menos" unicode a '-'
    s = s.replace(/\u2212/g, '-');

    // Conservar dÃ­gitos, separadores y el '-' inicial
    s = s.replace(/[^0-9,.\-]/g, ''); // ahora no borra el signo
    s = s.replace(/(?!^)-/g, '');     // si hubiera guiones en el medio, dejamos solo el inicial

    // es-AR: '.' miles, ',' decimales
    if (s.includes(',') && s.includes('.')) {
      // "1.234,56" -> "1234.56"
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }

    const num = parseFloat(s);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(2));
  } catch {
    return 0;
  }
}


function formatearMoneda(valor) {
    if (typeof valor !== 'number' || isNaN(valor)) {
        console.warn(`Valor no vÃ¡lido para formatearMoneda: ${valor}`);
        return '0,00';
    }
    return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function abrirOverlayStock(nombre, codigo, unidad, stockData) {
  const overlay = document.getElementById("stockOverlay");
  if (!overlay) {
    console.error("Error: No se encontrÃ³ el elemento #stockOverlay");
    return;
  }
  const nombreElem = document.getElementById("stockProductoNombre");
  const codigoElem = document.getElementById("stockProductoCodigo");
  const unidadElem = document.getElementById("stockProductoUnidad");
  const tabla = document.getElementById("stockTabla");
  const totalVenta = document.getElementById("totalVenta");
  const totalEntrega = document.getElementById("totalEntrega");
  const totalComprometido = document.getElementById("totalComprometido");

  if (!nombreElem || !codigoElem || !unidadElem || !tabla || !totalVenta || !totalEntrega || !totalComprometido) {
    console.error("Error: Faltan elementos dentro de #stockOverlay");
    return;
  }

  nombreElem.textContent = nombre;
  codigoElem.textContent = codigo;
  unidadElem.textContent = unidad;

  tabla.innerHTML = "";
  totalVenta.textContent = "0,00";
  totalEntrega.textContent = "0,00";
  totalComprometido.textContent = "0,00";

  if (!stockData || stockData.length === 0) {
    tabla.innerHTML = `<tr><td colspan="4" class="text-center text-danger">No hay stock disponible para este producto en la tienda seleccionada.</td></tr>`;
  } else {
    let sumaVenta = 0, sumaEntrega = 0, sumaComprometido = 0;
    stockData.forEach((stock) => {
      const row = document.createElement("tr");
      let disponibleVenta = convertirMonedaANumero(stock.disponible_venta);
      let disponibleEntrega = convertirMonedaANumero(stock.disponible_entrega);
      let comprometido = convertirMonedaANumero(stock.comprometido);
      sumaVenta += disponibleVenta;
      sumaEntrega += disponibleEntrega;
      sumaComprometido += comprometido;
      row.innerHTML = `
        <td>${stock.almacen_365}</td>
        <td>${formatearMoneda(disponibleVenta)}</td>
        <td>${formatearMoneda(disponibleEntrega)}</td>
        <td>${formatearMoneda(comprometido)}</td>
      `;
      tabla.appendChild(row);
    });
    totalVenta.textContent = formatearMoneda(sumaVenta);
    totalEntrega.textContent = formatearMoneda(sumaEntrega);
    totalComprometido.textContent = formatearMoneda(sumaComprometido);
  }

  // Mostrar overlay con animaciÃ³n
  overlay.classList.remove("d-none");
  setTimeout(() => {
    overlay.classList.add("active");
  }, 10); // PequeÃ±o retraso para activar la transiciÃ³n
}

function cerrarOverlaystock() {
  const overlay = document.getElementById("stockOverlay");
  if (overlay) {
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.classList.add("d-none");
    }, 300); // Esperar a que termine la animaciÃ³n
  }
}

async function mostrarAtributos(productId) {
    const overlay = document.getElementById("productOverlay");
    const overlayContent = document.getElementById("overlayContent");

    if (!overlay || !overlayContent) {
        console.error("No se encontraron elementos del overlay.");
        return;
    }

    try {
        showSpinner();
        const data = await fetchWithAuth(`/producto/atributos/${productId}`);
        const productName = data.product_name || "Producto sin nombre";
        const attributes = data.attributes || [];

        const imageUrls = await Promise.all([1, 2, 3].map(async i => {
            const url = getImageUrl(productId, i);
            const exists = await imageExists(url, productId, i);
            return exists ? url : null;
        })).then(results => results.filter(url => url !== null));

        const defaultImage = "/static/img/default.jpg";
        const validImages = imageUrls.length > 0 ? imageUrls : [defaultImage];

        overlayContent.innerHTML = `
            <button class="overlay-close-btn" onclick="cerrarOverlay()">Ã—</button>
            <div class="header text-center mb-4">
                <img src="https://productimages.familiabercomat.com/small/logo_0.png" alt="Logo de Familia Bercomat" class="logo mb-3">
                <h1 class="product-title">${productName}</h1>
            </div>
            <div class="product-container d-flex flex-column flex-md-row gap-4">
                <div class="product-images flex-1">
                    <img id="mainImage" src="${validImages[0]}" alt="Producto" class="main-image">
                    <div class="thumbnail-container mt-3" id="thumbnail-container">
                        ${validImages.map((url, index) => `
                            <img src="${url}" alt="Imagen ${index + 1}" class="thumbnail" data-index="${index}">
                        `).join("")}
                    </div>
                </div>
                <div class="product-details flex-1">
                    <div class="specs">
                        <h2>Especificaciones</h2>
                        <ul id="specifications-list">
                            ${attributes.length > 0 ? attributes.map(item => `
                                <li class="section-attribute">
                                    <span class="label">${item.AttributeName}:</span>
                                    <span class="value">${item.AttributeValue}</span>
                                </li>
                            `).join("") : `
                                <li style="color: var(--icon-color); font-style: italic;">Este producto no tiene atributos disponibles.</li>
                            `}
                        </ul>
                    </div>
                </div>
            </div>
        `;

        const mainImage = overlayContent.querySelector("#mainImage");
        mainImage.addEventListener("click", () => {
            mainImage.classList.toggle("zoomed");
        });

        const thumbnails = overlayContent.querySelectorAll(".thumbnail");
        thumbnails.forEach(thumbnail => {
            thumbnail.addEventListener("mouseover", () => {
                mainImage.src = thumbnail.src;
            });
        });

        overlay.classList.remove("d-none");
        setTimeout(() => {
            overlay.classList.add("active");
        }, 10);

        overlay.addEventListener("click", function handleOverlayClick(event) {
            if (event.target === overlay) {
                cerrarOverlay();
                overlay.removeEventListener("click", handleOverlayClick);
            }
        });

        overlayContent.addEventListener("mouseleave", cerrarOverlay);

    } catch (error) {
        console.error("Error al mostrar atributos:", error);
        overlayContent.innerHTML = `<p class="text-danger text-center">Error al cargar los atributos del producto: ${error.message}</p>`;
        overlay.classList.remove("d-none");
        setTimeout(() => {
            overlay.classList.add("active");
        }, 10);
    } finally {
        hideSpinner();
    }
}

function sanitizeText(text) {
    // Permitir letras, nÃºmeros, espacios y algunos caracteres bÃ¡sicos, eliminando otros especiales
    return text.replace(/[^a-zA-Z0-9Ã¡Ã©Ã­Ã³ÃºÃÃ‰ÃÃ“ÃšÃ±Ã‘\s.,-]/g, "").substring(0, 180);
}

document.addEventListener("DOMContentLoaded", function () {
    const observationsInput = document.getElementById("cartObservations");
    if (observationsInput) {
        observationsInput.addEventListener("input", function (e) {
            cartObservations = sanitizeText(e.target.value);
            e.target.value = cartObservations;
            cart.observations = cartObservations;
            const timestamp = new Date().toISOString();
            getUserId().then(userId => {
                Promise.all([
                    saveCartToIndexedDB(userId, cart, timestamp),
                    syncCartWithBackend(userId, cart, timestamp)
                ]).catch(error => {
                    console.error('Error al guardar observaciones:', error);
                    showToast('danger', 'Error al guardar observaciones');
  });
});

// Atajos de teclado F1â€“F10
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
    // Evitar interferir mientras se escribe en campos de texto
    if (isTyping) return;
    switch (e.key) {
      case 'F1': // Foco en bÃºsqueda
        e.preventDefault();
        document.getElementById('search')?.focus();
        break;
      case 'F2': // Abrir/Toggle carrito
        e.preventDefault();
        try { toggleCart(); } catch {}
        break;
      case 'F3': // Limpiar filtros
        e.preventDefault();
        try { clearFilters(); } catch {}
        break;
      case 'F4': // Abrir escÃ¡ner
        e.preventDefault();
        try { openScannerModal(); } catch {}
        break;
      case 'F5': // Vista tabla
        e.preventDefault();
        try { cambiarVista('tabla'); } catch {}
        break;
      case 'F6': // Vista cards
        e.preventDefault();
        try { cambiarVista('cards'); } catch {}
        break;
      case 'F7': // Buscar cliente
        e.preventDefault();
        try { openClientSearchModal(); } catch {}
        break;
      case 'F8': // Recuperar presupuesto
        e.preventDefault();
        try { openRecoverQuotationModal(); } catch {}
        break;
      case 'F9': // Abrir simulador de pagos (si existe modal)
        e.preventDefault();
        try { bootstrap.Modal.getOrCreateInstance('#modalPagos').show(); } catch {}
        break;
      case 'F10': // Generar presupuesto (si existe modal)
        e.preventDefault();
        try { bootstrap.Modal.getOrCreateInstance('#quotationTypeModal').show(); } catch {}
        break;
      default:
        break;
    }
  });
});
        });
    }

});

async function updateCartPrices(storeId) {

    // Asegurarse de que cart.items sea un array
    if (!cart.items || !Array.isArray(cart.items)) {
        console.warn('cart.items no es un array, inicializando como []:', cart.items);
        cart.items = [];
    }

    if (!cart.items.length) {
        return;
    }

    cart.items.forEach(item => {
        const updatedProduct = products.find(p => p.numero_producto === item.productId);
        if (updatedProduct) {
            item.price = convertirMonedaANumero(updatedProduct.precio_final_con_descuento);
            item.precioLista = convertirMonedaANumero(updatedProduct.precio_final_con_iva);
            item.unidadMedida = updatedProduct.unidad_medida;
            item.multiplo = Number(updatedProduct.multiplo.toFixed(2));
            item.available = true; // Marcar como disponible

        } else {
            console.warn(`Producto ${item.productId} no encontrado en la tienda ${storeId}. Marcando como no disponible.`);
            item.available = false; // Marcar como no disponible
        }
    });

    const timestamp = new Date().toISOString();
    const userId = await getUserId();
    if (!userId) {
        console.warn('Usuario no autenticado, guardando solo en IndexedDB');
        await saveCartToIndexedDB('anonymous', cart, timestamp);
        return;
    }

    await Promise.all([
        saveCartToIndexedDB(userId, cart, timestamp),
        syncCartWithBackend(userId, cart, timestamp)
    ]).then(() => {
        if (cart.items.length > 0) {
        }
    }).catch(error => {
        console.error('Error al guardar carrito despuÃ©s de actualizar precios:', error);
        showToast('danger', 'Error al guardar los cambios del carrito.');
    });
}

function cerrarOverlay() {
    const overlay = document.getElementById("productOverlay");
    const overlayContent = document.getElementById("overlayContent");

    if (overlay && overlayContent) {
        overlay.classList.remove("active");
        setTimeout(() => {
            overlay.classList.add("d-none");
            overlayContent.innerHTML = ''; // Limpiar contenido
        }, 300); // Esperar a que termine la animaciÃ³n
    }
}

function setupRowListeners() {
    const rows = document.querySelectorAll("#productList tr");
    if (!rows) {
        console.warn("No se encontraron filas para configurar listeners.");
        return;
    }

    rows.forEach(row => {
        row.addEventListener("mousedown", function (event) {
            this.dataset.isSelecting = "false";
        });

        row.addEventListener("mousemove", function () {
            this.dataset.isSelecting = "true";
        });

        row.addEventListener("mouseup", function (event) {
            // Excluir clics en .product-image, .btn-stock y .btn-cart
            if (this.dataset.isSelecting === "false") {
                if (!event.target.closest(".product-image, .btn-stock, .btn-cart, input, textarea")) {
                    mostrarAtributos(this.dataset.productId);
                }
            }
        });
    });
}

function setupCardListeners() {
    const cards = document.querySelectorAll(".card");
    if (!cards.length) {
        console.warn("No se encontraron cards para configurar listeners.");
        return;
    }

    cards.forEach(card => {
        card.addEventListener("mousedown", function (event) {
            this.dataset.isSelecting = "false";
        });

        card.addEventListener("mousemove", function () {
            this.dataset.isSelecting = "true";
        });

        card.addEventListener("mouseup", function (event) {
            // Excluir clics en .product-image, .btn-stock y .btn-cart
            if (this.dataset.isSelecting === "false") {
                if (!event.target.closest(".product-image, .btn-stock, .btn-cart, input, textarea")) {
                    const productId = card.getAttribute("data-product-id");
                    if (productId) {
                        mostrarAtributos(productId);
                    }
                }
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", function () {
    setTimeout(() => {
        const btnTableView = document.getElementById("btnTableView");
        const btnCardView = document.getElementById("btnCardView");

        if (!btnTableView || !btnCardView) {
            console.error("Error: No se encontraron los botones `btnTableView` o `btnCardView` en el DOM.");
            return;
        }

        btnTableView.addEventListener("click", () => cambiarVista("tabla"));
        btnCardView.addEventListener("click", () => cambiarVista("cards"));
    }, 200); //
});

function actualizarFiltrosPrecio(origen) {
    const priceRangeSelect = document.getElementById("priceRangeFilter");
    const minPriceInput = document.getElementById("minPrice");
    const maxPriceInput = document.getElementById("maxPrice");

    if (origen === "select") {
        // ðŸ”¹ Si el usuario selecciona un rango predefinido
        const priceRange = priceRangeSelect.value;
        if (!priceRange) {
            minPriceInput.value = "";
            maxPriceInput.value = "";
        } else {
            const [min, max] = priceRange.split("-").map(Number);
            minPriceInput.value = min;
            maxPriceInput.value = max === 999999999 ? "" : max;
        }
    } else if (origen === "manual") {
        // ðŸ”¹ Si el usuario edita manualmente, reseteamos el select
        priceRangeSelect.value = "";
    }

    // ðŸ”¹ Aplicar el filtro con los valores actuales
    filterAndPaginate(false);
}

// âœ… Agregar eventos separados para cada cambio
document.getElementById("priceRangeFilter").addEventListener("change", () => actualizarFiltrosPrecio("select"));
document.getElementById("minPrice").addEventListener("input", () => actualizarFiltrosPrecio("manual"));
document.getElementById("maxPrice").addEventListener("input", () => actualizarFiltrosPrecio("manual"));

function initLazyLoading() {
    const lazyImages = document.querySelectorAll("img.lazyload");

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const dataSrc = img.getAttribute("data-src");
                    const container = img.closest(".image-container");
                    const spinner = container ? container.querySelector(".image-spinner") : null;

                    if (dataSrc) {
                        img.src = dataSrc;
                        img.onload = () => {
                            if (spinner) spinner.style.display = "none"; // Ocultar spinner cuando la imagen carga
                            img.classList.add("loaded");
                            img.classList.remove("lazyload");
                            observer.unobserve(img);
                        };
                        img.onerror = () => {
                            if (spinner) spinner.style.display = "none"; // Ocultar spinner si falla
                            img.src = "/static/img/default.jpg"; // Imagen por defecto en caso de error
                        };
                        img.removeAttribute("data-src");
                    }
                }
            });
        }, {
            rootMargin: "100px",
            threshold: 0.1
        });

        lazyImages.forEach(img => {
            if (img.getAttribute("data-src")) {
                observer.observe(img);
            }
        });
    } else {
        // Fallback para navegadores sin IntersectionObserver
        lazyImages.forEach(img => {
            const dataSrc = img.getAttribute("data-src");
            if (dataSrc) {
                img.src = dataSrc;
                img.onload = () => {
                    const container = img.closest(".image-container");
                    const spinner = container ? container.querySelector(".image-spinner") : null;
                    if (spinner) spinner.style.display = "none";
                };
                img.removeAttribute("data-src");
            }
        });
    }
}

// Ejecutar al cargar la pÃ¡gina
document.addEventListener("DOMContentLoaded", initLazyLoading);

function ajustarImagenModal() {
    const modalImg = document.getElementById("modalImage");
    if (!modalImg) return;

    if (modalImg.src.includes("default.jpg")) {
        modalImg.style.width = "400px";  // ðŸ”¹ Ajusta a un tamaÃ±o fijo si es default
        modalImg.style.height = "auto";
    } else {
        modalImg.style.width = "";
        modalImg.style.height = "";
    }
}

function limpiarCacheImagenes() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
        if (key.startsWith("img_cache_")) {
            localStorage.removeItem(key);
        }
    });
}

function limpiarCacheCada24Horas() {
    const cacheKey = "ultimaLimpiezaCache";
    const ultimaLimpieza = localStorage.getItem(cacheKey);
    const ahora = Date.now();
    const unDiaEnMilisegundos = 24 * 60 * 60 * 1000;

    if (!ultimaLimpieza || (ahora - parseInt(ultimaLimpieza, 10)) > unDiaEnMilisegundos) {
        limpiarCacheImagenes();
        localStorage.setItem(cacheKey, ahora.toString());
    }
}

function detectarHardRefresh() {
    const navigationEntries = performance.getEntriesByType("navigation");

    if (navigationEntries.length > 0 && navigationEntries[0].type === "reload") {

        if (sessionStorage.getItem("ultimaRecarga") === "soft") {
            limpiarCacheImagenes();
        }

        sessionStorage.setItem("ultimaRecarga", "hard");
    } else {
        sessionStorage.setItem("ultimaRecarga", "soft");
    }
}


document.addEventListener("DOMContentLoaded", () => {
    limpiarCacheCada24Horas();
    detectarHardRefresh();
});

/***************************************
 * Funciones del carrito
 ***************************************/

function validarCantidad(multiplo, cantidad) {
    try {
        // Asegurar que multiplo sea un nÃºmero vÃ¡lido
        const multiploValido = (multiplo === null || multiplo === undefined || isNaN(multiplo) || multiplo <= 0) ? 1 : parseFloat(multiplo.toFixed(2));
        // Asegurar que cantidad sea un nÃºmero vÃ¡lido
        const cantidadNum = isNaN(cantidad) ? 1 : parseFloat(cantidad);
        const tolerance = 0.0001;
        const cantidadRedondeada = Number(cantidadNum.toFixed(2));

        if (Math.abs(cantidadRedondeada % multiploValido) < tolerance || multiploValido === 1) {
            return cantidadRedondeada;
        } else {
            const cantidadAjustada = Math.ceil(cantidadRedondeada / multiploValido) * multiploValido;
            return Number(cantidadAjustada.toFixed(2));
        }
    } catch (error) {
        console.error('DEBUG: Error en validarCantidad:', error);
        return 1; // Valor por defecto en caso de error
    }
}

function isUnidadM2(unidad) {
    if (!unidad) return false;
    const u = String(unidad).trim().toLowerCase();
    return u === 'm2' || u === 'mÂ²' || u === 'm^2';
}

function formatCantidadPorUnidad(cantidad, unidad) {
    const n = Number(cantidad || 0);
    return isUnidadM2(unidad) ? Number(n.toFixed(2)) : Number(n.toFixed(0));
}

function calcularCajas(cantidad, multiplo, unidadMedida) {
    if (!["m2", "M2"].includes(unidadMedida)) return ""; // Solo para m2 o M2
    const multiploValido = (multiplo === null || multiplo === undefined || multiplo <= 0) ? 1 : parseFloat(multiplo);
    const multiploRedondeado = Number(multiploValido.toFixed(2));
    const cantidadRedondeada = Number(cantidad.toFixed(2));
    const cajas = cantidadRedondeada / multiploRedondeado;
    return `Equivalente a ${cajas.toFixed(0)} caja${cajas === 1 ? "" : "s"}`;
}

function showQuantityModal(event, productId, productName, price) {
    event.stopPropagation();
    const parsedPrice = convertirMonedaANumero(String(price));
    const product = products.find(p => p.numero_producto === productId) || {
        numero_producto: productId,
        nombre_producto: productName,
        precio_final_con_descuento: price,
        precio_final_con_iva: price, // Valor por defecto si no se encuentra el producto
        multiplo: 1,
        unidad_medida: "Un"
    };
    const multiplo = product ? Number(product.multiplo.toFixed(2)) : 1;
    const unidadMedida = product ? product.unidad_medida : "Un";
    const precioLista = convertirMonedaANumero(product.precio_final_con_iva);


    currentProductToAdd = {
        productId,
        productName,
        price: parsedPrice,
        multiplo,
        unidadMedida,
        precioLista // Nuevo campo para precio sin descuento
    };

    document.getElementById("quantityModalProductName").textContent = productName;
    document.getElementById("quantityModalProductPrice").textContent = `$${formatearMoneda(parsedPrice)}`;
    const input = document.getElementById("quantityInput");
    input.value = formatCantidadPorUnidad(multiplo, unidadMedida);
    input.min = multiplo;
    input.step = String(Number(multiplo || 1).toFixed(2));
    document.getElementById("quantityModalUnitMeasure").textContent = unidadMedida;

    const cantidadInicial = validarCantidad(multiplo, multiplo);
    input.value = formatCantidadPorUnidad(cantidadInicial, unidadMedida);
    const cajasElement = document.getElementById("quantityModalCajas");
    cajasElement.textContent = calcularCajas(cantidadInicial, multiplo, unidadMedida);
    updateTotal();

    const modalElement = document.getElementById("quantityModal");
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    modalElement.addEventListener('shown.bs.modal', function () {
        input.focus();
    }, { once: true });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const addButton = document.querySelector('#quantityModal .modal-footer .btn-primary');
            if (addButton) {
                addButton.focus();
            }
        }
    });
}

function adjustQuantity(delta) {
    const input = document.getElementById("quantityInput");
    let quantity = parseFloat(input.value) || currentProductToAdd.multiplo; // Usar multiplo como valor inicial si estÃ¡ vacÃ­o
    const step = delta * currentProductToAdd.multiplo; // Calcular el paso basado en el multiplo

    // Ajustar la cantidad sumando el paso
    quantity += step;

    // Asegurar que no baje del mÃ­nimo (multiplo)
    if (quantity < currentProductToAdd.multiplo) {
        quantity = currentProductToAdd.multiplo;
    }

    // Validar y ajustar al mÃºltiplo correcto
    const cantidadValidada = validarCantidad(currentProductToAdd.multiplo, quantity);
    input.value = cantidadValidada;

    // Actualizar equivalencia y total
    const cajasElement = document.getElementById("quantityModalCajas");
    cajasElement.textContent = calcularCajas(cantidadValidada, currentProductToAdd.multiplo, currentProductToAdd.unidadMedida);
    updateTotal();
}

function updateTotal() {
    const quantity = parseFloat(document.getElementById("quantityInput").value) || currentProductToAdd.multiplo;
    const total = currentProductToAdd.price * Number(quantity.toFixed(2)); // Redondear cantidad para cÃ¡lculo
    document.getElementById("quantityModalTotal").textContent = `$${formatearMoneda(total)}`;

    // Actualizar equivalencia al cambiar la cantidad
    const cajasElement = document.getElementById("quantityModalCajas");
    cajasElement.textContent = calcularCajas(quantity, currentProductToAdd.multiplo, currentProductToAdd.unidadMedida);
}

function addToCartConfirmed() {
    const quantityInput = document.getElementById("quantityInput");
    let quantity = parseFloat(quantityInput.value);
    const modal = bootstrap.Modal.getInstance(document.getElementById("quantityModal"));
    const addButton = document.querySelector('#quantityModal .modal-footer .btn-primary');

    if (!currentProductToAdd || isNaN(quantity) || quantity <= 0) {
        showToast('danger', 'Cantidad invÃ¡lida');
        return;
    }

    addButton.disabled = true;

    // Validar y normalizar cantidad a mÃºltiplo y 2 decimales si aplica
    quantity = validarCantidad(currentProductToAdd.multiplo, quantity);

    const existingItemIndex = cart.items.findIndex(item => item.productId === currentProductToAdd.productId);
    if (existingItemIndex !== -1) {
        cart.items[existingItemIndex].quantity += quantity;
    } else {
        cart.items.push({
            productId: currentProductToAdd.productId,
            productName: currentProductToAdd.productName,
            price: currentProductToAdd.price,
            quantity: quantity,
            unidadMedida: currentProductToAdd.unidadMedida,
            multiplo: currentProductToAdd.multiplo,
            precioLista: currentProductToAdd.precioLista
        });
    }


    const timestamp = new Date().toISOString();
    getUserId().then(userId => {
        Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]).then(() => {
            updateCartDisplay();
            modal.hide();
            addButton.disabled = false;
        }).catch(error => {
            console.error('Error al guardar el carrito:', error);
            showToast('danger', 'Error al guardar el carrito');
        });
    });
}

function updateCartDisplay() {
  const cartItemsDesktop = document.getElementById("cartItemsDesktop");
  const cartItemsMobile  = document.getElementById("cartItemsMobile");
  const cartItemCount    = document.getElementById("cartItemCount");
  const cartTotalFloat   = document.getElementById("cartTotalFloat");
  const cartTotalFixed   = document.getElementById("cartTotalFixed");
  const cartClientInfo   = document.getElementById("cartClientInfo");
  let   cartClientFloat  = document.getElementById("cartClientFloat");
  const observationsInput = document.getElementById("cartObservations");

  // Si no existe el footer del carrito en esta vista, salir de forma suave.
  if (!cartTotalFixed) {
    console.warn("updateCartDisplay: 'cartTotalFixed' no estÃ¡ disponible en esta pÃ¡gina. Render parcial.");
    // Aun asÃ­, actualizamos contadores flotantes si existen y salimos.
    if (cartItemCount)   cartItemCount.textContent = cart.items.length.toString();
    if (cartTotalFloat) {
      const total = cart.items.reduce((acc, it) => acc + it.price * it.quantity, 0);
      cartTotalFloat.textContent = total.toLocaleString('es-AR', { minimumFractionDigits: 2 });
    }
    // Mostrar/ocultar info de cliente si el bloque existe
    if (cartClientInfo) cartClientInfo.style.display = cart.client ? "block" : "none";
    return;
  }

  // Observaciones (si existe el textarea)
  if (observationsInput) {
    cartObservations = sanitizeText(observationsInput.value || "");
  }

  // Asegurar span del cliente en el botÃ³n flotante
  if (!cartClientFloat) {
    const floatButton = document.querySelector(".cart-float-btn");
    if (floatButton) {
      cartClientFloat = document.createElement("span");
      cartClientFloat.id = "cartClientFloat";
      cartClientFloat.textContent = "Sin cliente";
      floatButton.appendChild(cartClientFloat);
    }
  }
  if (cartClientFloat) {
    cartClientFloat.textContent = (cart.client && cart.client.nombre_cliente) ? cart.client.nombre_cliente : "Sin cliente";
  }

  // Muestra/oculta resumen de cliente dentro del carrito
  if (cartClientInfo) {
    if (cart.client) {
      const safe = (v) => v ?? "N/A";
      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = safe(val); };
      setText("cartClientName",    cart.client.nombre_cliente);
      setText("cartClientNumber",  cart.client.numero_cliente);
      setText("cartClientNif",     cart.client.nif);
      setText("cartClientAddress", cart.client.direccion_completa);
      cartClientInfo.style.display = "block";
    } else {
      cartClientInfo.style.display = "none";
    }
  }

  // Render de lÃ­neas (si existen contenedores)
  if (cartItemsDesktop && cartItemsMobile) {
    cartItemsDesktop.innerHTML = "";
    cartItemsMobile.innerHTML  = "";

    const isMobile = window.innerWidth <= 768;
    cartItemsDesktop.parentElement.style.display = isMobile ? "none" : "table";
    cartItemsMobile.parentElement.style.display  = isMobile ? "block" : "none";

    // Render simple de ejemplo (ajusta a tu markup real)
    const renderRow = (item, idx) => {
      const total = item.price * item.quantity;
      const qtyValue = isUnidadM2(item.unidadMedida) ? Number(item.quantity || 0).toFixed(2) : Number(item.quantity || 0);
      const stepValue = (typeof item.multiplo !== 'undefined' && !isNaN(item.multiplo)) ? Number(item.multiplo).toFixed(2) : '1';
      return `
        <tr>
          <td>${item.productId}</td>
          <td>${item.productName}</td>
          <td>${item.unidadMedida ?? "-"}</td>
          <td>${item.multiplo ?? "-"}</td>
          <td>
            <input type="number" class="form-control form-control-sm" value="${qtyValue}" min="0" step="${stepValue}"
                   onchange="adjustCartQuantity(${idx}, parseFloat(this.value))">
          </td>
          <td>$ ${item.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td>$ ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" onclick="removeFromCart(${idx})">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>`;
    };

    cart.items.forEach((it, i) => {
      if (cartItemsDesktop) cartItemsDesktop.insertAdjacentHTML("beforeend", renderRow(it, i));
      // En mÃ³vil puedes usar tarjetas; por brevedad, reutilizo una fila compacta:
      if (cartItemsMobile) {
        const total = it.price * it.quantity;
        const qtyValue = isUnidadM2(it.unidadMedida) ? Number(it.quantity || 0).toFixed(2) : Number(it.quantity || 0);
        const stepValue = (typeof it.multiplo !== 'undefined' && !isNaN(it.multiplo)) ? Number(it.multiplo).toFixed(2) : '1';
        cartItemsMobile.insertAdjacentHTML("beforeend", `
          <div class="cart-row-mobile p-2 mb-2 border rounded">
            <div class="d-flex justify-content-between">
              <strong>${it.productName}</strong>
              <button class="btn btn-sm btn-outline-danger" onclick="removeFromCart(${i})"><i class="bi bi-trash"></i></button>
            </div>
            <div class="small text-muted">${it.productId} Â· ${it.unidadMedida ?? "-"}</div>
            <div class="d-flex align-items-center gap-2 mt-2">
              <input type="number" class="form-control form-control-sm" style="width:90px" value="${qtyValue}" min="0" step="${stepValue}"
                     onchange="adjustCartQuantity(${i}, parseFloat(this.value))">
              <span class="ms-auto">$ ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>`);
      }
    });
  }

  // Totales en botÃ³n flotante y en footer del carrito
  const totalCarrito = cart.items.reduce((acc, it) => acc + it.price * it.quantity, 0);
  if (cartItemCount) cartItemCount.textContent = cart.items.length.toString();
  if (cartTotalFloat) cartTotalFloat.textContent = totalCarrito.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  cartTotalFixed.textContent = totalCarrito.toLocaleString('es-AR', { minimumFractionDigits: 2 });

  // (Opcional) mostrar ID de presupuesto si aplica
  let quotationIdDisplay = document.getElementById("quotationIdDisplay");
  if (!quotationIdDisplay && cartClientInfo && cartClientInfo.parentElement) {
    quotationIdDisplay = document.createElement("p");
    quotationIdDisplay.id = "quotationIdDisplay";
    quotationIdDisplay.className = "text-muted mb-2";
    cartClientInfo.parentElement.insertBefore(quotationIdDisplay, cartClientInfo.nextSibling);
  }
  if (quotationIdDisplay) {
    quotationIdDisplay.textContent = (cart.quotation_id && cart.type !== 'new')
      ? `Presupuesto: ${cart.quotation_id} (${cart.type === 'd365' ? 'D365' : 'Local'})`
      : "Nuevo Presupuesto";
  }
}

window.addEventListener("resize", () => {
  const cartItemsDesktop = document.getElementById("cartItemsDesktop");
  const cartItemsMobile = document.getElementById("cartItemsMobile");
  const isMobileResize = window.innerWidth <= 768;

  if (cartItemsDesktop && cartItemsMobile) {
    if (isMobileResize) {
      cartItemsDesktop.parentElement.style.display = "none";
      cartItemsMobile.parentElement.style.display = "block";
    } else {
      cartItemsDesktop.parentElement.style.display = "table";
      cartItemsMobile.parentElement.style.display = "none";
    }
  }

  updateCartDisplay();
});

function updateCartQuantity(index, newQuantity) {
    const quantity = parseFloat(newQuantity);
    if (!cart.items[index]) {
        console.warn(`Ãtem en Ã­ndice ${index} no existe en cart.items`);
        return;
    }
    const cantidadValidada = validarCantidad(cart.items[index].multiplo, quantity);
    cart.items[index].quantity = cantidadValidada;

    const timestamp = new Date().toISOString();
    getUserId().then(userId => {
        if (!userId) {
            saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                updateCartDisplay();
            });
            return;
        }
        Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]).then(() => {
            updateCartDisplay();
        }).catch(error => {
            console.error('Error al actualizar cantidad del carrito:', error);
            updateCartDisplay();
        });
    });
}

function adjustCartQuantity(index, delta) {
    try {
        // Validar que el Ã­tem existe y tiene las propiedades necesarias
        if (!cart.items[index]) {
            throw new Error(`Ãtem en Ã­ndice ${index} no existe en cart.items`);
        }
        if (typeof cart.items[index].quantity !== 'number' || isNaN(cart.items[index].quantity)) {
            console.warn(`Cantidad invÃ¡lida para Ã­tem ${index}, inicializando a 1:`, cart.items[index].quantity);
            cart.items[index].quantity = 1;
        }
        if (typeof cart.items[index].multiplo !== 'number' || isNaN(cart.items[index].multiplo)) {
            console.warn(`MÃºltiplo invÃ¡lido para Ã­tem ${index}, inicializando a 1:`, cart.items[index].multiplo);
            cart.items[index].multiplo = 1;
        }

        let quantity = cart.items[index].quantity + (delta * cart.items[index].multiplo);
        if (quantity < cart.items[index].multiplo) quantity = cart.items[index].multiplo;
        quantity = Number(quantity.toFixed(2));
        const cantidadValidada = validarCantidad(cart.items[index].multiplo, quantity);
        cart.items[index].quantity = cantidadValidada;

        // Sincronizar con IndexedDB y backend
        const timestamp = new Date().toISOString();
        getUserId().then(userId => {
            if (!userId) {
                console.warn('Usuario no autenticado, guardando solo en IndexedDB');
                saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                    updateCartDisplay();
                });
                return;
            }
            Promise.all([
                saveCartToIndexedDB(userId, cart, timestamp),
                syncCartWithBackend(userId, cart, timestamp)
            ]).then(() => {
                updateCartDisplay();
            }).catch(error => {
                console.error('Error al sincronizar cantidad:', error);
                showToast('danger', 'Error al guardar la cantidad');
            });
        });
    } catch (error) {
        console.error('DEBUG: Error en adjustCartQuantity:', error);
        showToast('danger', `Error al ajustar cantidad: ${error.message}`);
    }
}

function clearCart() {
    cart = {
        items: [],
        client: null,
        quotation_id: null,
        type: 'new',
        observations: ''
    };
    cartObservations = '';
    const obsInputReset = document.getElementById("cartObservations");
    if (obsInputReset) obsInputReset.value = '';
    const timestamp = new Date().toISOString();
    getUserId().then(userId => {
        Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]).then(() => {
            updateCartDisplay();
        }).catch(error => {
            console.error('Error al vaciar el carrito:', error);
            showToast('danger', 'Error al vaciar el carrito');
        });
    });
}

function removeFromCart(index) {
    cart.items.splice(index, 1);
    const timestamp = new Date().toISOString();
    getUserId().then(userId => {
        if (!userId) {
            console.warn('Usuario no autenticado, guardando solo en IndexedDB');
            saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                updateCartDisplay();
            });
            return;
        }
        Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]).then(() => {
            updateCartDisplay();
        }).catch(error => {
            console.error('Error al eliminar Ã­tem del carrito:', error);
            showToast('danger', 'Error al eliminar el producto');
        });
    });
}

// === Reemplazo completo de toggleCart ===
function toggleCart() {
  const cartOverlay = document.getElementById("cartOverlay");
  if (!cartOverlay) {
    console.warn("toggleCart: No existe #cartOverlay en esta vista. AsegÃºrate de usar layout.html o de incluir el overlay.");
    showToast?.('warning', 'Carrito no disponible en esta vista.');
    return;
  }
  cartOverlay.classList.toggle("d-none");
  // Al abrir/cerrar, refrescamos el contenido por si hubo cambios
  try { updateCartDisplay(); } catch (e) { console.error(e); }
}

// === Reemplazo completo del bloque que registra listeners en DOMContentLoaded ===
document.addEventListener("DOMContentLoaded", function () {
  // 1) Asignar cambio de cantidad en el modal de cantidad (si existe)
  const quantityInput = document.getElementById("quantityInput");
  if (quantityInput) {
    quantityInput.addEventListener("change", function () {
      const quantity = parseFloat(this.value);
      const multiplo = (currentProductToAdd && currentProductToAdd.multiplo) || 1;
      const unidad   = (currentProductToAdd && currentProductToAdd.unidadMedida) || '';
      const cantidadValidada = validarCantidad(multiplo, quantity);
      this.value = cantidadValidada;

      const cajasElement = document.getElementById("quantityModalCajas");
      if (cajasElement) {
        cajasElement.textContent = calcularCajas(cantidadValidada, multiplo, unidad);
      }
      updateTotal?.();
    });
  }

  // 2) Unificar el click del botÃ³n flotante del carrito (si existe)
  const cartButton = document.querySelector('.cart-float-btn');
  if (cartButton) {
    cartButton.onclick = function () {
      toggleCart();              // abrir/cerrar overlay
      toggleCartButtonDetails?.(); // expandir/colapsar detalles en el botÃ³n
    };
  }
});


function showClientDetailsModal() {
    const modalElement = document.getElementById("clientDetailsModal");
    if (!modalElement) {
        console.error("Error: El elemento con ID 'clientDetailsModal' no se encuentra en el DOM.");
        showToast("danger", "No se pudo abrir el modal de detalles del cliente.");
        return;
    }
    if (!cart.client) {
        console.error("Error: No hay cliente seleccionado en el carrito.");
        showToast("warning", "No hay cliente seleccionado para mostrar detalles.");
        return;
    }
    if (typeof bootstrap === "undefined" || !bootstrap.Modal) {
        console.error("Error: Bootstrap no estÃ¡ cargado o la clase Modal no estÃ¡ definida.");
        showToast("danger", "Error de configuraciÃ³n: Bootstrap no estÃ¡ disponible.");
        return;
    }

    // Llenar los datos del cliente (ya se hace en selectClient, pero usamos los mismos datos aquÃ­)
    document.getElementById("modalClientName").textContent = cart.client.nombre_cliente || "N/A";
    document.getElementById("modalClientNumber").textContent = cart.client.numero_cliente || "N/A";
    document.getElementById("modalClientBlocked").textContent = cart.client.bloqueado || "N/A";
    document.getElementById("modalClientType").textContent = cart.client.tipo_contribuyente || "N/A";
    document.getElementById("modalClientCreditLimit").textContent = cart.client.limite_credito ? `$${cart.client.limite_credito.toFixed(2)}` : "N/A";
    document.getElementById("modalClientTaxGroup").textContent = cart.client.grupo_impuestos || "N/A";
    document.getElementById("modalClientNif").textContent = cart.client.nif || "N/A";
    document.getElementById("modalClientTif").textContent = cart.client.tif || "N/A";
    document.getElementById("modalClientAddress").textContent = cart.client.direccion_completa || "N/A";
    document.getElementById("modalClientEmail").textContent = cart.client.email_contacto || "N/A";
    document.getElementById("modalClientPhone").textContent = cart.client.telefono_contacto || "N/A";
    document.getElementById("modalClientCreateDate").textContent = cart.client.fecha_creacion || "N/A";
    document.getElementById("modalClientModDate").textContent = cart.client.fecha_modificacion || "N/A";

    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

// Variable global para almacenar el nÃºmero del presupuesto
let lastQuotationNumber = null;

// Mostrar modal de selecciÃ³n de tipo
function showQuotationTypeModal() {
  if (!cart.items.length) {
    showToast('danger', 'El carrito estÃ¡ vacÃ­o.');
    return;
  }
  if (!cart.client || !cart.client.numero_cliente) {
    showToast('danger', 'Debe seleccionar un cliente antes de generar el presupuesto.');
    return;
  }
  const modal = new bootstrap.Modal(document.getElementById('quotationTypeModal'));
  modal.show();
}

// Crear presupuesto con el tipo seleccionado
async function createInD365WithType(tipo_presupuesto) {
    const typeModal = bootstrap.Modal.getInstance(document.getElementById('quotationTypeModal'));
    typeModal.hide();

    if (!cart.items.length) {
        showToast('danger', 'El carrito estÃ¡ vacÃ­o.');
        return;
    }

    if (!cart.client || !cart.client.numero_cliente) {
        showToast('danger', 'Debe seleccionar un cliente antes de generar el presupuesto.');
        return;
    }

    showSpinner();
    try {
        const __sf = document.getElementById("storeFilter") || document.getElementById("storeFilterRetail"); const storeId = __sf ? (__sf.value || "BA001GC") : (typeof getLastStore === "function" ? getLastStore() : "BA001GC");
        const payload = {
            cart: {
                items: cart.items.filter(item => item.productId),
                client: cart.client || {},
                observations: cartObservations
            },
            store_id: storeId,
            tipo_presupuesto: tipo_presupuesto
        };

        let response;
        if (cart.type === "d365" && cart.quotation_id) {
            // Actualizar presupuesto existente en D365
            response = await fetch(`/api/update_quotation/${cart.quotation_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            // Crear nuevo presupuesto en D365
            response = await fetch('/api/create_quotation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Error al procesar el presupuesto");

        lastQuotationNumber = result.quotation_number;
        toggleCart();

        // Mostrar modal de confirmaciÃ³n para imprimir
        await showPrintConfirmationModal(lastQuotationNumber, tipo_presupuesto);

        // No limpiar aquÃ­, se manejarÃ¡ en closePrintModal
    } catch (error) {
        console.error("Error al procesar en D365:", error);
        showToast('danger', `Error: ${error.message}`);
    } finally {
        hideSpinner();
    }
}

// Mostrar modal de confirmaciÃ³n de impresiÃ³n
function showPrintConfirmationModal(quotationNumber, tipo) {
    const modal = new bootstrap.Modal(document.getElementById('printConfirmationModal'));
    document.getElementById('printConfirmationMessage').textContent =
        `Se generÃ³ correctamente el presupuesto ${quotationNumber} (${tipo}).`;
    modal.show();
}

// Cerrar modal de confirmaciÃ³n y manejar la acciÃ³n
function closePrintModal(print) {
    const modal = bootstrap.Modal.getInstance(document.getElementById('printConfirmationModal'));
    modal.hide();

    if (print) {
        generatePDF().then(() => {
            // Limpiar carrito y observaciones despuÃ©s de generar el PDF
            cartObservations = "";
            const obsInput = document.getElementById("cartObservations");
            if (obsInput) obsInput.value = "";
            delete cart.quotation_id;
            delete cart.type;
            clearCart();

            // Sincronizar el carrito despuÃ©s de limpiar
            const timestamp = new Date().toISOString();
            getUserId().then(userId => {
                if (!userId) {
                    console.warn('Usuario no autenticado, guardando solo en IndexedDB');
                    saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                        updateCartDisplay();
                    });
                    return;
                }
                Promise.all([
                    saveCartToIndexedDB(userId, cart, timestamp),
                    syncCartWithBackend(userId, cart, timestamp)
                ]).then(() => {
                    updateCartDisplay();
                }).catch(error => {
                    console.error('Error al sincronizar el carrito despuÃ©s de limpiar:', error);
                });
            });
        }).catch(error => {
            console.error("Error al generar PDF:", error);
            showToast('danger', 'Error al generar el PDF.');

            // Limpiar carrito y observaciones incluso si falla la generaciÃ³n del PDF
            cartObservations = "";
            const obsInput = document.getElementById("cartObservations");
            if (obsInput) obsInput.value = "";
            delete cart.quotation_id;
            delete cart.type;
            clearCart();

            // Sincronizar el carrito despuÃ©s de limpiar
            const timestamp = new Date().toISOString();
            getUserId().then(userId => {
                if (!userId) {
                    console.warn('Usuario no autenticado, guardando solo en IndexedDB');
                    saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                        updateCartDisplay();
                    });
                    return;
                }
                Promise.all([
                    saveCartToIndexedDB(userId, cart, timestamp),
                    syncCartWithBackend(userId, cart, timestamp)
                ]).then(() => {
                    updateCartDisplay();
                }).catch(error => {
                    console.error('Error al sincronizar el carrito despuÃ©s de limpiar:', error);
                });
            });
        });
    } else {
        // Limpiar carrito y observaciones si el usuario no imprime
        cartObservations = "";
        const obsInput = document.getElementById("cartObservations");
        if (obsInput) obsInput.value = "";
        delete cart.quotation_id;
        delete cart.type;
        clearCart();

        // Sincronizar el carrito despuÃ©s de limpiar
        const timestamp = new Date().toISOString();
        getUserId().then(userId => {
            if (!userId) {
                console.warn('Usuario no autenticado, guardando solo en IndexedDB');
                saveCartToIndexedDB('anonymous', cart, timestamp).then(() => {
                    updateCartDisplay();
                });
                return;
            }
            Promise.all([
                saveCartToIndexedDB(userId, cart, timestamp),
                syncCartWithBackend(userId, cart, timestamp)
            ]).then(() => {
                updateCartDisplay();
            }).catch(error => {
                console.error('Error al sincronizar el carrito despuÃ©s de limpiar:', error);
            });
        });
    }
}

// FunciÃ³n para mostrar toast
function showToast(type, message) {
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.role = 'alert';
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    setTimeout(() => toast.remove(), 5000); // Remover despuÃ©s de 5 segundos
}

function generatePDF() {
    return new Promise((resolve, reject) => {

        if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
            console.error("jsPDF no estÃ¡ definido. AsegÃºrate de que la biblioteca estÃ© cargada.");
            showToast('danger', 'Error: No se pudo generar el PDF. Falta la biblioteca jsPDF.');
            reject(new Error("jsPDF no estÃ¡ definido"));
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4"
        });

        doc.setFont("helvetica", "normal");

        // Constantes para el manejo del espacio
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const FOOTER_HEIGHT = 20;
        const BOTTOM_MARGIN = FOOTER_HEIGHT + 10;
        const CONTENT_BOTTOM_LIMIT = PAGE_HEIGHT - BOTTOM_MARGIN;

        const currentDate = new Date().toLocaleString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 1);
        const validUntil = expiryDate.toLocaleString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });

        const __sf = document.getElementById("storeFilter") || document.getElementById("storeFilterRetail"); const storeId = __sf ? (__sf.value || "BA001GC") : (typeof getLastStore === "function" ? getLastStore() : "BA001GC");
        let direccionSucursal = "DirecciÃ³n no disponible";
        let vendedor = "Vendedor no disponible";

        const cartItems = JSON.parse(JSON.stringify(cart.items.filter(item => item.productId)));
        const cartClient = cart.client ? JSON.parse(JSON.stringify(cart.client)) : null;
        const cartCopy = { items: cartItems, client: cartClient };

        const addLogo = () => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const pageWidth = doc.internal.pageSize.getWidth();
                    const logoWidth = 50;
                    const logoHeight = 12;
                    const xPosition = pageWidth - logoWidth - 5;
                    doc.addImage(img, "PNG", xPosition, 20, logoWidth, logoHeight);
                    resolve();
                };
                img.onerror = () => {
                    console.warn("No se pudo cargar el logo.");
                    resolve();
                };
                img.src = "/static/img/logo_0.png";
            });
        };

        const addFooter = () => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const pageWidth = doc.internal.pageSize.getWidth();
                    const footerWidth = pageWidth - 20;
                    const footerHeight = (img.height * footerWidth) / img.width;
                    const footerYPosition = PAGE_HEIGHT - footerHeight - 10;
                    const pageCount = doc.internal.getNumberOfPages();
                    for (let i = 1; i <= pageCount; i++) {
                        doc.setPage(i);
                        doc.addImage(img, "PNG", 10, footerYPosition, footerWidth, footerHeight);
                    }
                    resolve(footerHeight);
                };
                img.onerror = () => {
                    console.warn("No se pudo cargar el pie de pÃ¡gina.");
                    resolve(FOOTER_HEIGHT);
                };
                img.src = "/static/img/pie.png";
            });
        };

        const checkPageBreak = (currentY, spaceNeeded, footerHeight) => {
            if (currentY + spaceNeeded > (PAGE_HEIGHT - footerHeight - 10)) {
                doc.addPage();
                return 10;
            }
            return currentY;
        };

        const addTextWithPageBreak = (text, x, y, footerHeight, options = {}) => {
            const lineHeight = doc.getLineHeight() / doc.internal.scaleFactor;
            const lines = doc.splitTextToSize(text, options.maxWidth || (doc.internal.pageSize.getWidth() - x - 10));
            let currentY = y;

            lines.forEach(line => {
                currentY = checkPageBreak(currentY, lineHeight, footerHeight);
                doc.text(line, x, currentY, options);
                currentY += lineHeight;
            });

            return currentY;
        };

        const generateContent = async () => {
            await addLogo();
            let footerHeight = await addFooter();
            const pageWidth = doc.internal.pageSize.getWidth();
            let currentY = 10;

            // TÃ­tulo
            doc.setFontSize(16);
            const titleWidth = doc.getTextWidth("Presupuesto");
            currentY = checkPageBreak(currentY, 15, footerHeight);
            doc.text("Presupuesto", pageWidth / 2 - titleWidth / 2, currentY);
            currentY += 15;

            // Datos del presupuesto
            doc.setFontSize(8);
            currentY = checkPageBreak(currentY, 18, footerHeight);
            doc.text(`Presupuesto Nro. ${lastQuotationNumber || 'N/A'}`, 10, currentY);
            doc.text(`Fecha y Hora: ${currentDate}`, 10, currentY + 6);
            doc.text(`VÃ¡lido hasta: ${validUntil}`, 10, currentY + 12);
            currentY += 18;

            // DirecciÃ³n sucursal
            currentY = checkPageBreak(currentY, 10, footerHeight);
            try {
                const response = await fetch(`/api/datos_tienda/${storeId}`);
                if (!response.ok) throw new Error("Error al obtener datos de la sucursal");
                const data = await response.json();
                direccionSucursal = data.direccion_completa_unidad_operativa || "DirecciÃ³n no disponible";
            } catch (error) {
                console.error("Error al obtener datos de la sucursal:", error);
            }
            doc.text(direccionSucursal, pageWidth - 10, currentY, { align: "right" });
            currentY += 10;

            // Datos del cliente
            doc.setFontSize(10);
            currentY = checkPageBreak(currentY, 25, footerHeight);
            doc.text("Preparado para", 10, currentY);
            doc.setFontSize(8);
            const clienteNombre = cartCopy.client?.nombre_cliente || "Consumidor Final";
            const clienteId = cartCopy.client?.numero_cliente || "N/A";
            const clienteIva = cartCopy.client?.tipo_contribuyente || "N/A";
            doc.text(`CÃ³digo de Cliente: ${clienteId}`, 10, currentY + 8);
            doc.text(`Nombre de Cliente: ${clienteNombre}`, 10, currentY + 14);
            doc.text(`CondiciÃ³n IVA: ${clienteIva}`, 10, currentY + 20);
            currentY += 25;

            // Vendedor
            currentY = checkPageBreak(currentY, 10, footerHeight);
            try {
                const response = await fetch('/api/user_info');
                if (!response.ok) throw new Error(`Error al obtener vendedor: ${response.status}`);
                const data = await response.json();
                vendedor = data.nombre_completo || "Vendedor no disponible";
            } catch (error) {
                console.warn("Error al obtener vendedor:", error);
                vendedor = "Usuario desconocido";
            }
            doc.text(`Vendedor: ${vendedor}`, pageWidth - 10, currentY, { align: "right" });
            currentY += 10;

            // Tabla de productos
            const tableHeaders = [
                "CÃ³digo",
                "DescripciÃ³n",
                "Cantidad",
                "U.M",
                "Precio Unitario Lista",
                "Precio Unitario con Desc.",
                "Importe Total"
            ];

            const tableData = cartCopy.items.map(item => {
                const precioFinalConIva = convertirMonedaANumero(item.precioLista) || 0;
                const precioFinalConDescuento = convertirMonedaANumero(item.price) || 0;
                const quantity = parseFloat(item.quantity) || 1;
                const totalDescuento = (precioFinalConIva - precioFinalConDescuento) * quantity;
                const porcentajeDescuento = precioFinalConIva !== 0
                    ? ((precioFinalConIva - precioFinalConDescuento) / precioFinalConIva) * 100
                    : 0;
                const importeTotal = precioFinalConDescuento * quantity;

                const row = [
                    item.productId || "N/A",
                    item.productName || "Producto sin nombre",
                    { content: quantity.toFixed(2).replace(".", ","), styles: { halign: "right" } },
                    item.unidadMedida || "un",
                    `$${formatearMoneda(precioFinalConIva)}`,
                    `$${formatearMoneda(precioFinalConDescuento)}`,
                    `$${formatearMoneda(importeTotal)}`
                ];

                // Solo agregar la fila de descuento si hay un descuento real
                if (totalDescuento > 0) {
                    row.push({
                        content: `Descuento: $${formatearMoneda(totalDescuento)} (${porcentajeDescuento.toFixed(2).replace(".", ",")}%)`,
                        colSpan: 7,
                        styles: { fontSize: 7, halign: "left", textColor: [100, 100, 100] }
                    });
                }

                return row;
            });

            const flattenedData = [];
            tableData.forEach(row => {
                flattenedData.push(row.slice(0, 7));
                if (row.length > 7) {
                    flattenedData.push(row.slice(7));
                }
            });

            doc.autoTable({
                startY: currentY,
                head: [tableHeaders],
                body: flattenedData,
                theme: "grid",
                headStyles: { fillColor: [180, 185, 199], textColor: [255, 255, 255], fontSize: 7 },
                bodyStyles: { fontSize: 8, lineHeight: 1.1 },
                columnStyles: {
                    0: { cellWidth: 25 },
                    1: { cellWidth: 55, overflow: "linebreak" },
                    2: { cellWidth: 20, halign: "right" },
                    3: { cellWidth: 15, halign: "center" },
                    4: { cellWidth: 25, halign: "right" },
                    5: { cellWidth: 25, halign: "right" },
                    6: { cellWidth: 25, halign: "right" }
                },
                styles: { minCellHeight: 8, cellPadding: 1 },
                margin: { left: 10, right: 10, bottom: footerHeight + 10 },
                pageBreak: "auto",
                didDrawPage: (data) => {
                    currentY = data.cursor.y;
                    const pageWidth = doc.internal.pageSize.getWidth();
                    const footerWidth = pageWidth - 20;
                    const footerYPosition = PAGE_HEIGHT - footerHeight - 10;
                    const img = new Image();
                    img.src = "/static/img/pie.png";
                    doc.addImage(img, "PNG", 10, footerYPosition, footerWidth, footerHeight);
                }
            });

            currentY = doc.lastAutoTable.finalY + 5;

            // Condiciones generales
            currentY = checkPageBreak(currentY, 10, footerHeight);
            doc.setFontSize(8);
            currentY = addTextWithPageBreak("Condiciones Generales:", 10, currentY, footerHeight);
            currentY = addTextWithPageBreak("â€¢ Oferta no vinculante, sujeta a modificaciÃ³n sin previo aviso", 15, currentY, footerHeight);

            // Observaciones
            currentY = checkPageBreak(currentY, 10, footerHeight);
            currentY = addTextWithPageBreak("Observaciones:", 10, currentY, footerHeight);
            if (cartObservations) {
                currentY = addTextWithPageBreak(cartObservations, 15, currentY, footerHeight, { maxWidth: 180 });
            } else {
                currentY = addTextWithPageBreak("Sin observaciones", 15, currentY, footerHeight);
            }

            // Calcular totales
            const totalDescuentos = cartCopy.items.reduce((sum, item) => {
                const precioFinalConIva = convertirMonedaANumero(item.precioLista) || 0;
                const precioFinalConDescuento = convertirMonedaANumero(item.price) || 0;
                const quantity = parseFloat(item.quantity) || 1;
                return sum + (precioFinalConIva - precioFinalConDescuento) * quantity;
            }, 0);

            const total = cartCopy.items.reduce((sum, item) => {
                const price = convertirMonedaANumero(item.price) || 0;
                const quantity = parseFloat(item.quantity) || 1;
                return sum + price * quantity;
            }, 0);

            // Crear tabla de totales solo si hay descuentos o un total vÃ¡lido
            const totalRows = [];
            if (totalDescuentos > 0) {
                totalRows.push(["Total de descuentos aplicados", "", "", "", "", "", `$${formatearMoneda(totalDescuentos)}`]);
            }
            totalRows.push(["Total", "", "", "", "", "", `$${formatearMoneda(total)}`]);

            doc.autoTable({
                startY: currentY,
                body: totalRows,
                theme: "plain",
                styles: { fontSize: 8, lineWidth: 0.1 },
                columnStyles: {
                    0: { cellWidth: 60, halign: "left" },
                    6: { cellWidth: 30, halign: "right" }
                },
                margin: { left: 10, right: 10, bottom: footerHeight + 10 },
                didDrawPage: (data) => {
                    currentY = data.cursor.y;
                    const pageWidth = doc.internal.pageSize.getWidth();
                    const footerWidth = pageWidth - 20;
                    const footerYPosition = PAGE_HEIGHT - footerHeight - 10;
                    const img = new Image();
                    img.src = "/static/img/pie.png";
                    doc.addImage(img, "PNG", 10, footerYPosition, footerWidth, footerHeight);
                }
            });

            currentY = doc.lastAutoTable.finalY + 6;
            currentY = checkPageBreak(currentY, 8, footerHeight);
            doc.setFontSize(10);
            currentY = addTextWithPageBreak("Forma de Pago", 10, currentY, footerHeight);
            doc.setFontSize(8);
            currentY = addTextWithPageBreak("Efectivo", 10, currentY, footerHeight);
            currentY = addTextWithPageBreak(`${formatearMoneda(total)}`, 10, currentY, footerHeight);

            const pdfBlob = doc.output('blob');
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const printWindow = window.open(pdfUrl);
            printWindow.onload = () => {
                printWindow.print();
                printWindow.onfocus = () => {
                    setTimeout(() => {
                        URL.revokeObjectURL(pdfUrl);
                        printWindow.close();
                    }, 0);
                };
            };

            resolve();
        };

        generateContent().catch(error => {
            console.error("Error en generateContent:", error);
            showToast('danger', `Error al generar el PDF: ${error.message}`);
            reject(error);
        });
    });
}

// Abrir el modal de bÃºsqueda de clientes
function openClientSearchModal() {
    const modal = new bootstrap.Modal(document.getElementById("clientSearchModal"));
    document.getElementById("clientSearchInput").value = "";
    document.getElementById("clientSearchResults").innerHTML = "";
    document.getElementById("selectedClientInfo").style.display = "none";
    document.getElementById("addClientToCartBtn").disabled = true;
    modal.show();
    setTimeout(() => document.getElementById("clientSearchInput").focus(), 500);
}

// BÃºsqueda al presionar Enter
document.addEventListener("DOMContentLoaded", function () {
    const addClientButton = document.querySelector('.btn-outline-success.ms-2');
    if (addClientButton) {
        addClientButton.addEventListener('click', function (e) {
            e.preventDefault();
            openAddClientModal();
        });
    }
    const clientSearchInput = document.getElementById("clientSearchInput");
    if (clientSearchInput) {
        clientSearchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const query = clientSearchInput.value.trim();
                if (query.length >= 3) {
                    searchClients(query);
                } else {
                    document.getElementById("clientSearchResults").innerHTML = '<p class="text-muted">Por favor, ingresa al menos 3 caracteres y presiona Enter.</p>';
                }
            }
        });
    }
});

async function searchClients(query) {
    try {
        showSpinner();
        const clients = await fetchWithAuth(`/api/clientes/search?query=${encodeURIComponent(query)}`);
        displayClientSearchResults(clients);
    } catch (error) {
        console.error("Error en bÃºsqueda de clientes:", error);
        document.getElementById("clientSearchResults").innerHTML = '<p class="text-danger">Error al buscar clientes: ' + error.message + '</p>';
    } finally {
        hideSpinner();
    }
}

function displayClientSearchResults(clients) {
  const resultsContainer = document.getElementById("clientSearchResults");
  resultsContainer.innerHTML = "";

  if (!clients.length) {
    resultsContainer.innerHTML = '<p class="text-muted">No se encontraron clientes.</p>';
    return;
  }

  clients.forEach(client => {
    const item = document.createElement("a");
    item.href = "#";
    item.className = "list-group-item list-group-item-action";
    item.innerHTML = `
      ${client.nombre_cliente} (NIF: ${client.nif || "N/A"} | TIF: ${client.tif || "N/A"} | T. Cont: ${client.tipo_contribuyente || "N/A"} | G. Imp: ${client.grupo_impuestos || "N/A"})
    `;
    item.onclick = (e) => {
      e.preventDefault();
      selectClient(client);
    };
    resultsContainer.appendChild(item);
  });
}

function selectClient(client) {
  selectedClient = client;
  const infoContainer = document.getElementById("selectedClientInfo");
  document.getElementById("clientName").textContent = client.nombre_cliente || "N/A";
  document.getElementById("clientNumber").textContent = client.numero_cliente || "N/A";
  document.getElementById("clientBlocked").textContent = client.bloqueado || "N/A";
  document.getElementById("clientType").textContent = client.tipo_contribuyente || "N/A";
  document.getElementById("clientCreditLimit").textContent = client.limite_credito ? `$${client.limite_credito.toFixed(2)}` : "N/A";
  document.getElementById("clientTaxGroup").textContent = client.grupo_impuestos || "N/A";
  document.getElementById("clientNif").textContent = client.nif || "N/A";
  document.getElementById("clientTif").textContent = client.tif || "N/A";
  document.getElementById("clientAddress").textContent = client.direccion_completa || "N/A";
  document.getElementById("clientModDate").textContent = client.fecha_modificacion || "N/A";
  document.getElementById("clientCreateDate").textContent = client.fecha_creacion || "N/A";
  document.getElementById("clientEmail").textContent = client.email_contacto || "N/A";
  document.getElementById("clientPhone").textContent = client.telefono_contacto || "N/A";
  infoContainer.style.display = "block";
  document.getElementById("addClientToCartBtn").disabled = false;
}

function addClientToCart() {
    if (!selectedClient) {
        showToast('danger', 'No se ha seleccionado un cliente');
        return;
    }

    cart.client = {
        numero_cliente: selectedClient.numero_cliente,
        nombre_cliente: selectedClient.nombre_cliente,
        nif: selectedClient.nif,
        direccion_completa: selectedClient.direccion_completa,
        bloqueado: selectedClient.bloqueado,
        tipo_contribuyente: selectedClient.tipo_contribuyente,
        limite_credito: selectedClient.limite_credito,
        grupo_impuestos: selectedClient.grupo_impuestos,
        tif: selectedClient.tif,
        email_contacto: selectedClient.email_contacto,
        telefono_contacto: selectedClient.telefono_contacto,
        fecha_creacion: selectedClient.fecha_creacion,
        fecha_modificacion: selectedClient.fecha_modificacion
    };

    const timestamp = new Date().toISOString();
    getUserId().then(userId => {
        Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]).then(() => {
            updateCartDisplay();
            bootstrap.Modal.getInstance(document.getElementById('clientSearchModal')).hide();
        }).catch(error => {
            console.error('Error al guardar cliente en el carrito:', error);
            showToast('danger', 'Error al aÃ±adir el cliente');
        });
    });
}

function removeClientFromCart() {
    if (cart.type === 'd365' && cart.quotation_id) {
        const modal = new bootstrap.Modal(document.getElementById("removeClientWarningModal"));
        document.getElementById("currentQuotationId").textContent = cart.quotation_id || "N/A";

        const confirmButton = document.getElementById("confirmRemoveClient");
        const confirmRemoval = new Promise((resolve) => {
            const onConfirm = () => {
                resolve(true);
                modal.hide();
                confirmButton.removeEventListener("click", onConfirm);
            };
            confirmButton.addEventListener("click", onConfirm);

            document.getElementById("removeClientWarningModal").addEventListener('hidden.bs.modal', () => {
                resolve(false);
                confirmButton.removeEventListener("click", onConfirm);
            }, { once: true });
        });

        modal.show();

        confirmRemoval.then((confirmed) => {
            if (confirmed) {
                cart.client = null;
                cart.quotation_id = null;
                cart.type = 'new';
                const timestamp = new Date().toISOString();
                getUserId().then(userId => {
                    Promise.all([
                        saveCartToIndexedDB(userId, cart, timestamp),
                        syncCartWithBackend(userId, cart, timestamp)
                    ]).then(() => {
                        updateCartDisplay();
                        showToast('success', 'Cliente eliminado. Se generarÃ¡ un nuevo presupuesto.');
                    });
                });
            } else {
                showToast('info', 'EliminaciÃ³n de cliente cancelada.');
            }
        });
    } else {
        cart.client = null;
        const timestamp = new Date().toISOString();
        getUserId().then(userId => {
            Promise.all([
                saveCartToIndexedDB(userId, cart, timestamp),
                syncCartWithBackend(userId, cart, timestamp)
            ]).then(() => {
                updateCartDisplay();
            });
        });
    }
}

async function invoiceCart() {
    if (!cart.items.length) {
        showToast('danger', 'El carrito estÃ¡ vacÃ­o.');
        return;
    }

    showSpinner();
    try {
        const total = cart.items
            .filter(item => item.productId && item.available !== false)
            .reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const payload = {
            items: cart.items.filter(item => item.productId),
            client: cart.client || null,
            total: total
        };

        const data = await fetchWithAuth('/api/facturar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        showToast('success', `Factura generada: ${data.factura.numero}`);
        clearCart();
    } catch (error) {
        console.error('Error al facturar:', error);
        showToast('danger', `Error al facturar: ${error.message}`);
    } finally {
        toggleCart();
        hideSpinner();
    }
}

async function generatePdfOnly() {
    if (!cart.items.length) {
        showToast('danger', 'El carrito estÃ¡ vacÃ­o.');
        return;
    }

    showSpinner();
    try {
        const data = await fetchWithAuth('/api/generate_pdf_quotation_id');
        lastQuotationNumber = data.quotation_id;

        const __sf = document.getElementById("storeFilter") || document.getElementById("storeFilterRetail"); const storeId = __sf ? (__sf.value || "BA001GC") : (typeof getLastStore === "function" ? getLastStore() : "BA001GC");
        const quotationData = {
            quotation_id: lastQuotationNumber,
            type: "local",
            store_id: storeId,
            client: cart.client || null,
            items: cart.items.filter(item => item.productId),
            observations: cartObservations,
            timestamp: new Date().toISOString()
        };

        const saveResponse = await fetchWithAuth('/api/save_local_quotation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(quotationData)
        });

        await generatePDF();

        cartObservations = "";
        const obsInput = document.getElementById("cartObservations");
        if (obsInput) obsInput.value = "";
        delete cart.quotation_id;
        delete cart.type;
        clearCart();

        const timestamp = new Date().toISOString();
        const userId = await getUserId();
        if (!userId) {
            console.warn('Usuario no autenticado, guardando solo en IndexedDB');
            await saveCartToIndexedDB('anonymous', cart, timestamp);
            updateCartDisplay();
            showToast('success', 'PDF generado y presupuesto guardado');
            return;
        }
        await Promise.all([
            saveCartToIndexedDB(userId, cart, timestamp),
            syncCartWithBackend(userId, cart, timestamp)
        ]);
        updateCartDisplay();
        showToast('success', `PDF generado y presupuesto guardado con ID: ${lastQuotationNumber}`);
    } catch (error) {
        console.error("Error al generar PDF o guardar presupuesto:", error);
        showToast('danger', `Error: ${error.message}`);
    } finally {
        toggleCart();
        hideSpinner();
    }
}

function openPaymentSimulator() {
    const totalStr = document.getElementById('cartTotalFloat')?.textContent || '0';
    const total = parseFloat(totalStr.replace(/\./g, '').replace(',', '.')) || 0;
    if (!total || total <= 0) {
        try { showToast('info', 'Agregá productos al carrito para simular pagos.'); } catch(_) {}
        return;
    }
    const externalBase = (window.SIMULATOR_EXT_URL || window.SIMULATOR_V5_URL || '').trim();
    if (externalBase) {
        // Prioriza abrir el simulador externo del ERP (puerto 8001)
        const url = externalBase + (externalBase.includes('?') ? '&' : '?') + `total=${total}`;
        window.open(url, '_blank');
        return;
    }
    // Fallback: simulador interno (pÃ¡gina propia)
    try {
        const modalEl = document.getElementById('paymentSimulatorModal');
        const frame = document.getElementById('paymentSimulatorFrame');
        if (!modalEl || !frame || typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            window.open(`/payments/simulator/?total=${total}`, '_blank');
            return;
        }
        frame.src = `/payments/simulator/?total=${total}`;
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } catch (err) {
        console.error('Error al abrir simulador de pagos:', err);
        window.open(`/payments/simulator/?total=${total}`, '_blank');
    }
}

function toggleCartButtonDetails() {
    const cartButton = document.querySelector('.cart-float-btn');
    const navCartBtn = document.getElementById('navbarCartBtn');
    if (navCartBtn) { navCartBtn.addEventListener('click', () => toggleCart()); }
    cartButton.classList.toggle('expanded');
}

// AsegÃºrate de que el evento onclick del botÃ³n combine ambas acciones
document.addEventListener("DOMContentLoaded", function () {
    const cartButton = document.querySelector('.cart-float-btn');
    if (cartButton) {
        // Combinar toggleCart y toggleCartButtonDetails en un solo clic
        cartButton.onclick = function () {
            toggleCart(); // Abrir/cerrar el overlay del carrito
            toggleCartButtonDetails(); // Mostrar/ocultar detalles
        };

        // Opcional: Cerrar detalles al salir del hover si no estÃ¡ expandido manualmente
        cartButton.addEventListener('mouseleave', function () {
            if (!this.classList.contains('expanded')) {
                this.classList.remove('expanded');
            }
        });
    }

    const simulatorModal = document.getElementById('paymentSimulatorModal');
    if (simulatorModal) {
        // Bloquear apertura si total es 0 cuando se use data attributes
        simulatorModal.addEventListener('show.bs.modal', function (ev) {
            const totalStr = document.getElementById('cartTotalFloat')?.textContent || '0';
            const total = parseFloat(totalStr.replace(/\./g, '').replace(',', '.')) || 0;
            if (!total || total <= 0) {
                ev.preventDefault();
                try { showToast('info', 'Agregá productos al carrito para simular pagos.'); } catch(_) {}
            }
        });
        simulatorModal.addEventListener('hidden.bs.modal', () => {
            const cartOverlay = document.getElementById('cartOverlay');
            if (cartOverlay && cartOverlay.classList.contains('d-none')) {
                cartOverlay.classList.remove('d-none');
            }
        });
    }
    // Evitar abrir modalPagos (POS) si total es 0
    const modalPagos = document.getElementById('modalPagos');
    if (modalPagos) {
        modalPagos.addEventListener('show.bs.modal', function (ev) {
            try {
                const t = (typeof calcularTotalesPOS === 'function') ? calcularTotalesPOS().total : 0;
                if (!t || t <= 0) {
                    ev.preventDefault();
                    showToast('info', 'Agregá productos al carrito para simular pagos.');
                }
            } catch (_) {
                // Si falla el cálculo, evitar apertura por seguridad
                ev.preventDefault();
                try { showToast('info', 'Agregá productos al carrito para simular pagos.'); } catch {}
            }
        });
    }
});

// Abrir el modal para agregar cliente
function openAddClientModal() {
    const modalElement = document.getElementById("addClientModal");
    if (!modalElement) {
        console.error("Error: El elemento con ID 'addClientModal' no se encuentra en el DOM.");
        showToast("danger", "No se pudo abrir el formulario para agregar cliente.");
        return;
    }
    if (typeof bootstrap === "undefined" || !bootstrap.Modal) {
        console.error("Error: Bootstrap no estÃ¡ cargado o la clase Modal no estÃ¡ definida.");
        showToast("danger", "Error de configuraciÃ³n: Bootstrap no estÃ¡ disponible.");
        return;
    }
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    // Limpiar y deshabilitar campos al abrir
    document.getElementById("newClientDni").value = "";
    document.getElementById("dniValidationMessage").textContent = "";
    togglePersonalFields(false);
    toggleAddressFields(false);
    document.getElementById("newClientZipCode").value = "";
    document.getElementById("newClientCitySelect").innerHTML = '<option value="">Seleccione una ciudad</option>';
    document.getElementById("newClientStreet").value = "";
    document.getElementById("newClientStreetNumber").value = "";
    document.getElementById("newClientReference").value = "";
    document.getElementById("newClientLatitude").value = "";
    document.getElementById("newClientLongitude").value = "";
    initMap();
}

// Inicializar el mapa de Google Maps
let map, geocoder, marker;
let postalCodeData = [];
let selectedCityData = null;

function initMap() {
    if (typeof google === 'undefined' || !google.maps) {
        console.error("Google Maps no estÃ¡ cargado aÃºn. Esperando carga...");
        setTimeout(initMap, 500);
        return;
    }

    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 8,
        center: { lat: -34.6037, lng: -58.3816 },
    });
    geocoder = new google.maps.Geocoder();
    marker = new google.maps.Marker({
        map: map,
        position: { lat: -34.6037, lng: -58.3816 },
        draggable: true,
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                map.setCenter(userLocation);
                map.setZoom(15);
                marker.setPosition(userLocation);
                updateLatLongFields(userLocation.lat, userLocation.lng);
            },
            (error) => {
                console.warn("Error al obtener la ubicaciÃ³n del usuario:", error.message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    }

    const streetInput = document.getElementById("newClientStreet");
    const streetNumberInput = document.getElementById("newClientStreetNumber");
    const citySelect = document.getElementById("newClientCitySelect");

    if (streetInput && streetNumberInput && citySelect) {
        streetInput.addEventListener("blur", () => {
            if (selectedCityData && streetInput.value.trim()) {
                geocodeFullAddress();
            }
        });

        streetNumberInput.addEventListener("blur", () => {
            if (selectedCityData && streetInput.value.trim()) {
                geocodeFullAddress();
            }
        });

        citySelect.addEventListener("change", () => {
            fillAddressFields();
            const street = streetInput.value.trim();
            if (street) {
                geocodeFullAddress();
            }
        });
    }

    google.maps.event.addListener(marker, "dragend", function () {
        const position = marker.getPosition();
        updateLatLongFields(position.lat(), position.lng());
        reverseGeocode(position.lat(), position.lng());
    });
}

function geocodeFullAddress() {
    const street = document.getElementById("newClientStreet").value.trim();
    const streetNumber = document.getElementById("newClientStreetNumber").value.trim();
    const zipCode = document.getElementById("newClientZipCode").value.trim();
    if (!selectedCityData || !street) {
        document.getElementById("geocodeAddressDisplay").textContent = "Faltan datos: calle o ciudad no seleccionada.";
        return;
    }

    // Construir la direcciÃ³n completa con cÃ³digo postal
    const address = `${street}${streetNumber ? " " + streetNumber : " S/N"}, ${selectedCityData.AddressCity}, ${selectedCityData.CountyName}, Argentina`;

    const displayElement = document.getElementById("geocodeAddressDisplay");
    displayElement.textContent = `Geolocalizando: ${address}`;

    geocoder.geocode({ address: address }, (results, status) => {
        if (status === "OK" && results[0]) {
            const location = results[0].geometry.location;
            map.setCenter(location);
            map.setZoom(15);
            marker.setPosition(location);
            updateLatLongFields(location.lat(), location.lng());
            displayElement.textContent = `GeolocalizaciÃ³n exitosa: ${address} (Lat: ${location.lat().toFixed(6)}, Lng: ${location.lng().toFixed(6)})`;
        } else {
            console.warn("GeocodificaciÃ³n fallida:", status);
            showToast('warning', 'No se pudo geolocalizar la direcciÃ³n ingresada. Ajuste el marcador manualmente.');
            displayElement.textContent = `Fallo en geolocalizaciÃ³n: ${address} (Estado: ${status})`;
        }
    });
}

// FunciÃ³n para obtener la direcciÃ³n desde coordenadas (geocodificaciÃ³n inversa)
function reverseGeocode(lat, lng) {
    const latlng = { lat: parseFloat(lat), lng: parseFloat(lng) };
    geocoder.geocode({ location: latlng }, (results, status) => {
        if (status === "OK" && results[0]) {
            updateLatLongFields(lat, lng);
            const displayElement = document.getElementById("geocodeAddressDisplay");
            displayElement.textContent = `UbicaciÃ³n ajustada manualmente: Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)} (DirecciÃ³n aproximada: ${results[0].formatted_address})`;
        } else {
            console.warn("GeocodificaciÃ³n inversa fallida:", status);
            showToast('warning', 'No se pudo obtener la direcciÃ³n a partir de las coordenadas.');
        }
    });
}

// Actualizar los campos de latitud y longitud
function updateLatLongFields(lat, lng) {
    const latField = document.getElementById("newClientLatitude");
    const lngField = document.getElementById("newClientLongitude");
    if (latField && lngField) {
        latField.value = lat.toFixed(10);
        lngField.value = lng.toFixed(10);
    }
}

// Ajustar las funciones existentes para integrar la geolocalizaciÃ³n
function fillAddressFields() {
    const citySelect = document.getElementById("newClientCitySelect");
    const selectedCity = citySelect.value;
    selectedCityData = postalCodeData.find(item => item.AddressCity === selectedCity);

    if (selectedCityData) {
        toggleAddressFields(true);
        document.getElementById("newClientStreet").focus();
        const street = document.getElementById("newClientStreet").value.trim();
        if (street) {
            geocodeFullAddress();
        }
    } else {
        toggleAddressFields(false);
        document.getElementById("geocodeAddressDisplay").textContent = "No hay ciudad seleccionada.";
    }
}

let videoStream = null;

// Abrir el modal del escÃ¡ner
function openScannerModal() {
    const modal = new bootstrap.Modal(document.getElementById("scannerModal"));
    modal.show();
    startScanner();
}

// Iniciar el escÃ¡ner
function startScanner() {
    const video = document.getElementById("scannerVideo");
    const scannerStatus = document.getElementById("scannerStatus");

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
            .then(stream => {
                videoStream = stream;
                video.srcObject = stream;
                video.play();
                scannerStatus.textContent = "Escaneando...";
                scanCode(video);
            })
            .catch(err => {
                console.error("Error al acceder a la cÃ¡mara:", err);
                scannerStatus.textContent = "No se pudo acceder a la cÃ¡mara. Por favor, permite el acceso.";
            });
    } else {
        scannerStatus.textContent = "El escaneo no es compatible con este dispositivo.";
    }
}

// Detener el escÃ¡ner
function stopScanner() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    const video = document.getElementById("scannerVideo");
    video.srcObject = null;
}

// Escanear QR o cÃ³digo de barras
function scanCode(video) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    function tick() {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Intentar escanear QR con jsQR
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
            if (qrCode) {
                handleScanResult(qrCode.data);
                return;
            }

            // Intentar escanear cÃ³digo de barras con QuaggaJS
            Quagga.decodeSingle({
                src: canvas.toDataURL("image/png"),
                numOfWorkers: 0, // Desactiva workers para simplicidad
                decoder: {
                    readers: ["code_128_reader", "ean_reader", "ean_8_reader", "upc_reader"]
                }
            }, result => {
                if (result && result.codeResult) {
                    handleScanResult(result.codeResult.code);
                } else {
                    requestAnimationFrame(tick);
                }
            });
        } else {
            requestAnimationFrame(tick);
        }
    }
    requestAnimationFrame(tick);
}

// Manejar el resultado del escaneo
function handleScanResult(code) {
    stopScanner();
    const modal = bootstrap.Modal.getInstance(document.getElementById("scannerModal"));
    modal.hide();

    // Verificar si el resultado es una URL y extraer el codigo_articulo
    let productCode = code;
    try {
        const urlPattern = /^(https?:\/\/.*\/)?(.*)\.html$/i;
        const match = code.match(urlPattern);
        if (match && match[2]) {
            productCode = match[2]; // Extraer el codigo_articulo antes de .html
        } else {
            showToast("warning", `El cÃ³digo escaneado no parece ser una URL vÃ¡lida, usando como cÃ³digo directo: ${code}`);
        }
    } catch (error) {
        console.error("Error al procesar la URL escaneada:", error);
        showToast("danger", "Error al procesar el cÃ³digo escaneado.");
        return;
    }

    // Obtener la tienda seleccionada
    const selectedStore = document.getElementById("storeFilter").value || getLastStore();

    // Buscar el producto en la tienda seleccionada y abrir el modal de cantidad
    fetch(`/api/productos/by_code?code=${encodeURIComponent(productCode)}&store=${encodeURIComponent(selectedStore)}`)
        .then(response => response.json())
        .then(data => {
            if (data.error || data.message || !data.length) {
                showToast("warning", data.message || `Error: ${data.error || "Producto no encontrado"}`);
            } else {
                const product = data[0]; // Tomar el primer producto encontrado
                // Abrir el modal de cantidad con los datos del producto
                showQuantityModalFromScan(productCode, product.nombre_producto, product.precio_final_con_descuento);
            }
        })
        .catch(error => {
            console.error("Error al buscar producto:", error);
            showToast("danger", "Error al buscar el producto escaneado.");
        });
}

// Nueva funciÃ³n para abrir el modal de cantidad desde el escaneo
function showQuantityModalFromScan(productId, productName, price) {
    const parsedPrice = convertirMonedaANumero(String(price));
    const product = products.find(p => p.numero_producto === productId) || {
        numero_producto: productId,
        nombre_producto: productName,
        precio_final_con_descuento: price,
        precio_final_con_iva: price, // Valor por defecto
        multiplo: 1,
        unidad_medida: "Un"
    };
    const multiplo = product ? Number(product.multiplo.toFixed(2)) : 1;
    const unidadMedida = product ? product.unidad_medida : "Un";
    const precioLista = convertirMonedaANumero(product.precio_final_con_iva);

    currentProductToAdd = {
        productId,
        productName,
        price: parsedPrice,
        multiplo,
        unidadMedida,
        precioLista
    };

    document.getElementById("quantityModalProductName").textContent = productName;
    document.getElementById("quantityModalProductPrice").textContent = `$${formatearMoneda(parsedPrice)}`;
    const input = document.getElementById("quantityInput");
    input.value = formatCantidadPorUnidad(multiplo, unidadMedida);
    input.min = multiplo;
    input.step = String(Number(multiplo || 1).toFixed(2));
    document.getElementById("quantityModalUnitMeasure").textContent = unidadMedida;

    const cantidadInicial = validarCantidad(multiplo, multiplo);
    input.value = formatCantidadPorUnidad(cantidadInicial, unidadMedida);
    const cajasElement = document.getElementById("quantityModalCajas");
    cajasElement.textContent = calcularCajas(cantidadInicial, multiplo, unidadMedida);
    updateTotal();

    const modalElement = document.getElementById("quantityModal");
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    modalElement.addEventListener('shown.bs.modal', function () {
        input.focus();
    }, { once: true });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const addButton = document.querySelector('#quantityModal .modal-footer .btn-primary');
            if (addButton) {
                addButton.focus();
            }
        }
    });
}

function openRecoverQuotationModal() {
    const modal = new bootstrap.Modal(document.getElementById('recoverQuotationModal'));
    modal.show();

    const searchInput = document.getElementById('quotationSearchInput');

    // Limpiar input y resultados al abrir
    searchInput.value = '';
    document.getElementById('quotationList').innerHTML = '';

    // Ejecutar bÃºsqueda inicial
    searchQuotations();
}

// Buscar presupuestos segÃºn el tipo seleccionado
async function searchQuotations() {
    const query = document.getElementById("quotationSearchInput").value.trim();
    const type = document.getElementById("quotationTypeSelect").value;
    const quotationList = document.getElementById("quotationList");
    quotationList.innerHTML = "";

    // Limpiar manejadores de eventos previos
    quotationList.removeEventListener('click', handleQuotationClick);

    try {
        if (type === "local") {
            const response = await fetch('/api/local_quotations');
            if (!response.ok) {
                console.error('DEBUG: Error al obtener presupuestos locales:', response.status);
                throw new Error('Error al obtener presupuestos locales');
            }
            const quotations = await response.json();

            const filteredQuotations = quotations.filter(q =>
                q.quotation_id.toLowerCase().includes(query.toLowerCase())
            );

            if (!filteredQuotations.length) {
                quotationList.innerHTML = '<p class="text-muted">No se encontraron presupuestos locales.</p>';
                return;
            }

            filteredQuotations.forEach((quotation, index) => {
                const item = document.createElement("a");
                item.href = "#";
                item.className = "list-group-item list-group-item-action";
                item.dataset.quotationId = quotation.quotation_id;
                item.innerHTML = `${quotation.quotation_id} | ${quotation.client_name || 'Sin cliente'} | ${new Date(quotation.timestamp).toLocaleString()}`;
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        loadQuotation(quotation.quotation_id, 'local');
                    } catch (error) {
                        console.error('DEBUG: Error al llamar loadQuotation:', error);
                        showToast('danger', `Error al cargar presupuesto ${quotation.quotation_id}: ${error.message}`);
                    }
                });
                quotationList.appendChild(item);
            });
        } else if (type === "d365") {
            if (!query.startsWith("VENT1-")) {
                quotationList.innerHTML = '<p class="text-muted">Ingresa un ID vÃ¡lido de D365 (VENT1-XXXXX).</p>';
                return;
            }

            showSpinner();
            const store = document.getElementById("storeFilter").value || getLastStore();
            const response = await fetch(`/api/d365_quotation/${query}?store=${store}`);
            hideSpinner();

            if (!response.ok) {
                const errorData = await response.json();
                console.error('DEBUG: Error al obtener presupuesto D365:', errorData);
                quotationList.innerHTML = `<p class="text-danger">${errorData.error || errorData.message}</p>`;
                return;
            }

            const quotation = await response.json();

            if (!quotation.quotation_id) {
                quotationList.innerHTML = '<p class="text-muted">No se encontraron presupuestos D365.</p>';
                return;
            }

            // Generar un Ãºnico elemento para el presupuesto
            const item = document.createElement("a");
            item.href = "#";
            item.className = "list-group-item list-group-item-action";
            item.dataset.quotationId = quotation.quotation_id;
            item.innerHTML = `${quotation.quotation_id} | ${quotation.client?.nombre_cliente || 'Sin cliente'} | ${new Date(quotation.timestamp).toLocaleString()}`;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    loadQuotation(quotation.quotation_id, 'd365');
                } catch (error) {
                    console.error('DEBUG: Error al llamar loadQuotation:', error);
                    showToast('danger', `Error al cargar presupuesto ${quotation.quotation_id}: ${error.message}`);
                }
            });
            quotationList.appendChild(item);
        }

        // Agregar manejador delegado para depuraciÃ³n
        quotationList.addEventListener('click', handleQuotationClick);
    } catch (error) {
        console.error('DEBUG: Error al buscar presupuestos:', error);
        quotationList.innerHTML = '<p class="text-danger">Error al cargar presupuestos.</p>';
    }
}

function handleQuotationClick(e) {
    console.log('DEBUG: Clic detectado en quotationList:', { target: e.target, quotationId: e.target.dataset.quotationId });
}

document.addEventListener("DOMContentLoaded", function () {
    const quotationSearchInput = document.getElementById("quotationSearchInput");
    if (quotationSearchInput) {
        // Eliminar el evento oninput si existe
        quotationSearchInput.oninput = null;

        // Agregar evento keypress para buscar al presionar Enter
        quotationSearchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const query = quotationSearchInput.value.trim();
                if (query.length >= 3) {
                    searchQuotations();
                } else {
                    const quotationList = document.getElementById("quotationList");
                    quotationList.innerHTML = '<p class="text-muted">Por favor, ingresa al menos 3 caracteres y presiona Enter.</p>';
                }
            }
        });
    }
});

// Cargar un presupuesto en el carrito
async function loadQuotation(quotationId, type) {
    try {
        showSpinner();
        const store = document.getElementById("storeFilter").value || getLastStore();
        const url = type === 'local' ? `/api/local_quotation/${quotationId}` : `/api/d365_quotation/${quotationId}?store=${store}`;

        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json();
            console.error('DEBUG: Error en la respuesta del servidor:', errorData);
            throw new Error(errorData.error || 'Error al cargar presupuesto');
        }
        const quotation = await response.json();

        // Verificar si el presupuesto D365 estÃ¡ confirmado
        if (type === 'd365' && quotation.header.SalesQuotationStatus === "Confirmed") {
            const createNew = await showConfirmedQuotationModal(quotation.quotation_id, quotation.header.GeneratedSalesOrderNumber);
            if (!createNew) {
                showToast('info', 'Carga del presupuesto cancelada.');
                return; // Salir si el usuario cancela
            }
            // Si el usuario elige crear un nuevo presupuesto, cargar las lÃ­neas como un nuevo presupuesto
            quotation.quotation_id = null;
            quotation.type = 'new';
        }

        // Verificar si el presupuesto D365 contenÃ­a Ã­tems de flete o servicio
        if (type === 'd365' && quotation.has_flete) {
            const continueLoading = await showFleteWarningModal();
            if (!continueLoading) {
                showToast('info', 'Carga del presupuesto cancelada.');
                return; // Salir si el usuario cancela
            }
        }

        // Armar estructura de cart con datos crudos del backend
        const rawCartStructure = {
            items: quotation.items || [],
            client: quotation.client || null,
            quotation_id: quotation.quotation_id || null,
            type: quotation.quotation_id ? type : 'new',
            observations: quotation.observations || ''
        };
        // Mapear Ã­tems directamente
        const itemsWithNumericPrices = (quotation.items || []).map(item => ({
            productId: item.productId || '',
            productName: item.productName || 'Producto desconocido',
            price: convertirMonedaANumero(item.price || 0),
            precioLista: convertirMonedaANumero(item.precioLista || item.price || 0),
            quantity: Number(item.quantity) || 1,
            multiplo: Number(item.multiplo) || 1,
            unidadMedida: item.unidadMedida || 'Un',
            available: true
        })).filter(item => item.productId);

        // Actualizar el carrito
        cart = {
            items: itemsWithNumericPrices,
            client: quotation.client || null,
            quotation_id: quotation.quotation_id || null,
            type: quotation.quotation_id ? type : 'new',
            observations: quotation.observations || '',
        };
        cartObservations = cart.observations;
        const observationsInput = document.getElementById("cartObservations");
        if (observationsInput) {
            observationsInput.value = cartObservations;
        }

        // Actualizar el filtro de tienda
        document.getElementById("storeFilter").value = quotation.store_id || "BA001GC";
        await updateCartPrices(document.getElementById("storeFilter").value);

        // Renderizar directamente
        updateCartDisplay();
        showToast('success', `Presupuesto ${quotationId} cargado en el carrito${!quotation.quotation_id ? ' como nuevo' : ''}.`);
        const modal = bootstrap.Modal.getInstance(document.getElementById("recoverQuotationModal"));
        modal.hide();
    } catch (error) {
        console.error("Error al cargar presupuesto:", error);
        showToast('danger', `Error: ${error.message}`);
    } finally {
        hideSpinner();
    }
}

function showConfirmedQuotationModal(quotationId, orderNumber) {
    return new Promise((resolve) => {
        const modalElement = document.getElementById('confirmedQuotationModal');
        if (!modalElement) {
            console.error('Error: No se encontrÃ³ el elemento con ID "confirmedQuotationModal" en el DOM.');
            showToast('danger', 'No se pudo abrir el modal de advertencia de presupuesto confirmado.');
            resolve(false); // Continuar sin mostrar el modal
            return;
        }

        // Llenar los datos del presupuesto y pedido en el modal
        const quotationIdSpan = modalElement.querySelector('#confirmedQuotationId');
        const orderNumberSpan = modalElement.querySelector('#confirmedOrderNumber');
        quotationIdSpan.textContent = quotationId || 'N/A';
        orderNumberSpan.textContent = orderNumber || 'N/A';

        const modal = new bootstrap.Modal(modalElement);
        modal.show();

        const createNewButton = modalElement.querySelector('#createNewQuotation');
        const cancelButton = modalElement.querySelector('#cancelNewQuotation');

        const onCreateNew = () => {
            resolve(true);
            modal.hide();
            createNewButton.removeEventListener('click', onCreateNew);
        };

        const onCancel = () => {
            resolve(false);
            modal.hide();
            createNewButton.removeEventListener('click', onCreateNew);
        };

        createNewButton.addEventListener('click', onCreateNew);
        cancelButton.addEventListener('click', onCancel);

        modalElement.addEventListener('hidden.bs.modal', () => {
            resolve(false); // Por defecto, cancelar si se cierra el modal
            createNewButton.removeEventListener('click', onCreateNew);
            cancelButton.removeEventListener('click', onCancel);
        }, { once: true });
    });
}

function showFleteWarningModal() {
    return new Promise((resolve) => {
        const modalElement = document.getElementById('fleteWarningModal');
        if (!modalElement) {
            console.error('Error: No se encontrÃ³ el elemento con ID "fleteWarningModal" en el DOM.');
            showToast('danger', 'No se pudo abrir el modal de advertencia de flete.');
            resolve(false); // Continuar sin mostrar el modal
            return;
        }

        const modal = new bootstrap.Modal(modalElement);
        modal.show();

        const continueButton = modalElement.querySelector('#confirmFleteRemoval');
        const cancelButton = modalElement.querySelector('[data-bs-dismiss="modal"]');

        const onContinue = () => {
            resolve(true);
            modal.hide();
            continueButton.removeEventListener('click', onContinue);
        };

        const onCancel = () => {
            resolve(false);
            modal.hide();
            continueButton.removeEventListener('click', onContinue);
        };

        continueButton.addEventListener('click', onContinue);
        cancelButton.addEventListener('click', onCancel);

        modalElement.addEventListener('hidden.bs.modal', () => {
            resolve(false); // Por defecto, cancelar si se cierra el modal
            continueButton.removeEventListener('click', onContinue);
            cancelButton.removeEventListener('click', onCancel);
        }, { once: true });
    });
}

function togglePersonalFields(enable) {
    const fields = ["newClientName", "newClientLastName", "newClientEmail", "newClientPhone", "newClientZipCode"];
    fields.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = !enable;
    });
}

function toggleAddressFields(enable) {
    const fields = ["newClientCitySelect", "newClientStreet", "newClientStreetNumber", "newClientReference"];
    fields.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = !enable;
    });
    document.getElementById("saveClientBtn").disabled = !enable;
}

// ValidaciÃ³n del DNI
async function validateDni() {
    const dni = document.getElementById("newClientDni").value.trim();
    const messageElement = document.getElementById("dniValidationMessage");

    // ValidaciÃ³n de longitud mÃ­nima
    if (!dni || dni.length < 6) {
        messageElement.textContent = "El DNI debe tener al menos 6 dÃ­gitos.";
        togglePersonalFields(false);
        toggleAddressFields(false);
        return;
    }

    // Mostrar spinner durante la validaciÃ³n
    showSpinner();
    try {
        const response = await fetch("/api/clientes/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dni }),
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Error al validar DNI");

        if (result.exists) {
            messageElement.textContent = "El cliente ya existe con este DNI.";
            togglePersonalFields(false);
            toggleAddressFields(false);
        } else {
            messageElement.textContent = "";
            togglePersonalFields(true); // Habilitar campos personales y cÃ³digo postal
            toggleAddressFields(false); // Mantener direcciÃ³n bloqueada hasta seleccionar ciudad
            document.getElementById("newClientName").focus(); // Poner foco en nombre
        }
    } catch (error) {
        messageElement.textContent = "Error al validar DNI: " + error.message;
        togglePersonalFields(false);
        toggleAddressFields(false);
    } finally {
        hideSpinner();
    }
}

async function loadPostalCodeData() {
    const zipCode = document.getElementById("newClientZipCode").value.trim();
    const citySelect = document.getElementById("newClientCitySelect");

    if (!zipCode) {
        citySelect.innerHTML = '<option value="">Seleccione una ciudad</option>';
        toggleAddressFields(false);
        return;
    }

    // Mostrar spinner durante la consulta
    showSpinner();
    try {
        const response = await fetch("/api/direcciones/codigo_postal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigo_postal: zipCode }),
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Error al consultar cÃ³digo postal");

        postalCodeData = data;
        citySelect.innerHTML = '<option value="">Seleccione una ciudad</option>';
        if (data.length === 0) {
            citySelect.innerHTML += '<option value="">No se encontraron ciudades</option>';
            toggleAddressFields(false);
        } else {
            data.forEach(item => {
                const option = document.createElement("option");
                option.value = item.AddressCity;
                option.textContent = `${item.AddressCity} (${item.CountyName})`;
                citySelect.appendChild(option);
            });
            citySelect.disabled = false; // Habilitar el selector de ciudades
        }
    } catch (error) {
        console.error("Error:", error);
        citySelect.innerHTML = '<option value="">Error al cargar ciudades</option>';
        toggleAddressFields(false);
    } finally {
        hideSpinner();
    }
}

function fillAddressFields() {
    const citySelect = document.getElementById("newClientCitySelect");
    const selectedCity = citySelect.value;
    selectedCityData = postalCodeData.find(item => item.AddressCity === selectedCity);

    if (selectedCityData) {
        toggleAddressFields(true); // Habilitar campos de direcciÃ³n
        document.getElementById("newClientStreet").focus();
        // Geolocalizar automÃ¡ticamente si ya hay calle y altura
        const street = document.getElementById("newClientStreet").value.trim();
        const streetNumber = document.getElementById("newClientStreetNumber").value.trim();
        if (street && streetNumber) {
            geocodeFullAddress();
        }
    } else {
        toggleAddressFields(false); // Mantener bloqueados si no se selecciona ciudad
    }
}

async function saveNewClient() {
    const datosCliente = {
        dni: document.getElementById("newClientDni").value.trim(),
        nombre: document.getElementById("newClientName").value.trim(),
        apellido: document.getElementById("newClientLastName").value.trim(),
        email: document.getElementById("newClientEmail").value.trim(),
        telefono: document.getElementById("newClientPhone").value.trim(),
        codigo_postal: document.getElementById("newClientZipCode").value.trim(),
        ciudad: selectedCityData?.AddressCity || "",
        estado: selectedCityData?.AddressState || "",
        condado: selectedCityData?.AddressCounty || "",
        calle: document.getElementById("newClientStreet").value.trim(),
        altura: document.getElementById("newClientStreetNumber").value.trim(),
        referencia: document.getElementById("newClientReference").value.trim(),
        latitud: parseFloat(document.getElementById("newClientLatitude").value) || 0,
        longitud: parseFloat(document.getElementById("newClientLongitude").value) || 0
    };

    // Validar campos requeridos
    const requiredFields = ["dni", "nombre", "apellido", "email", "telefono", "codigo_postal", "ciudad", "calle", "altura"];
    for (const field of requiredFields) {
        if (!datosCliente[field]) {
            showToast("danger", `El campo ${field} es obligatorio.`);
            return;
        }
    }

    try {
        showSpinner();
        const response = await fetch("/api/clientes/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datosCliente),
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Error al crear cliente");

        showToast("success", "Cliente creado exitosamente: " + result.customer_id);
        const modal = bootstrap.Modal.getInstance(document.getElementById("addClientModal"));
        modal.hide();
        addClientToCartFromData(datosCliente, result.customer_id);

        // Limpiar los campos del modal
        document.getElementById("newClientDni").value = "";
        document.getElementById("newClientName").value = "";
        document.getElementById("newClientLastName").value = "";
        document.getElementById("newClientEmail").value = "";
        document.getElementById("newClientPhone").value = "";
        document.getElementById("newClientZipCode").value = "";
        document.getElementById("newClientCitySelect").innerHTML = '<option value="">Seleccione una ciudad</option>';
        document.getElementById("newClientStreet").value = "";
        document.getElementById("newClientStreetNumber").value = "";
        document.getElementById("newClientReference").value = "";
        document.getElementById("newClientLatitude").value = "";
        document.getElementById("newClientLongitude").value = "";
        document.getElementById("dniValidationMessage").textContent = "";
        document.getElementById("geocodeAddressDisplay").textContent = "";
        togglePersonalFields(false);
        toggleAddressFields(false);
        selectedCityData = null; // Resetear la selecciÃ³n de ciudad
        postalCodeData = []; // Limpiar datos de cÃ³digos postales
        // Reiniciar el mapa a una posiciÃ³n por defecto
        if (map && marker) {
            map.setCenter({ lat: -34.6037, lng: -58.3816 });
            map.setZoom(8);
            marker.setPosition({ lat: -34.6037, lng: -58.3816 });
        }

    } catch (error) {
        console.error("Error al crear cliente:", error);
        showToast("danger", `Error al crear cliente: ${error.message}`);
    } finally {
        hideSpinner();
        const modal = bootstrap.Modal.getInstance(document.getElementById("clientSearchModal"));
        modal.hide();
    }
}

function addClientToCartFromData(cliente, customer_id) {
    // Construir el objeto cart.client con todos los campos necesarios para el modal de detalles
    cart.client = {
        numero_cliente: customer_id, // Usar el ID generado por D365
        nombre_cliente: `${cliente.nombre} ${cliente.apellido}`,
        nif: cliente.dni,
        direccion_completa: `${cliente.calle} ${cliente.altura}, ${cliente.ciudad}`,
        email_contacto: cliente.email,
        telefono_contacto: cliente.telefono,
        bloqueado: "No",
        tipo_contribuyente: "CF",
        limite_credito: 5,
        grupo_impuestos: "C-CF",
        tif: "DNI",
        fecha_creacion: new Date().toISOString(),
        fecha_modificacion: new Date().toISOString()
    };
    updateCartDisplay();
}


function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains(CART_STORE)) {
                db.createObjectStore(CART_STORE, { keyPath: 'userId' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('Error al inicializar IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Guardar el carrito en IndexedDB
function saveCartToIndexedDB(userId, cartData, timestamp) {
    if (!db) {
        console.warn('IndexedDB no estÃ¡ inicializado');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CART_STORE], 'readwrite');
        const store = transaction.objectStore(CART_STORE);
        const cartEntry = {
            userId: userId,
            cart: cartData,
            timestamp: timestamp
        };


        const request = store.put(cartEntry);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            console.error('Error al guardar carrito en IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Restaurar el carrito desde IndexedDB
function loadCartFromIndexedDB(userId) {
    if (!db) {
        console.warn('IndexedDB no estÃ¡ inicializado');
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CART_STORE], 'readonly');
        const store = transaction.objectStore(CART_STORE);
        const request = store.get(userId);

        request.onsuccess = (event) => {
            const result = event.target.result;
            if (result && result.cart) {
                resolve({ cart: result.cart, timestamp: result.timestamp });
            } else {
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error('Error al cargar carrito desde IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Obtener el ID del usuario autenticado (email)
async function getUserId() {
    try {
        const response = await fetch('/api/user_info', {
            credentials: 'include' // Incluir cookies de sesiÃ³n
        });
        if (!response.ok) {
            throw new Error(`Error al obtener informaciÃ³n del usuario: ${response.status}`);
        }
        const data = await response.json();
        if (!data.email) {
            console.warn('No se encontrÃ³ email en la respuesta de /api/user_info:', data);
            return null;
        }
        sessionStorage.setItem('email', data.email);
        return data.email;
    } catch (error) {
        console.error('No se pudo obtener el ID del usuario:', error);
        const storedEmail = sessionStorage.getItem('email');
        if (storedEmail && storedEmail !== 'anonymous') {
            return storedEmail; // Usar email almacenado si existe y no es 'anonymous'
        }
        return null; // No devolver 'anonymous' para forzar autenticaciÃ³n
    }
}

// Sincronizar con el backend
async function syncCartWithBackend(userId, cartData, timestamp) {
    try {
        // Validar y corregir estructura del carrito antes de enviar
        if (!cartData || typeof cartData !== 'object') {
            console.error('Carrito invÃ¡lido para sincronizaciÃ³n:', cartData);
            throw new Error('Carrito invÃ¡lido: no es un objeto');
        }

        // Asegurar que 'items' exista y sea un array
        cartData.items = Array.isArray(cartData.items) ? cartData.items : [];

        const response = await fetch('/api/save_user_cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, cart: cartData, timestamp })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error en la respuesta del servidor:', errorData);
            throw new Error(errorData.error || 'Error al sincronizar carrito con el servidor');
        }

    } catch (error) {
        console.error('Error al sincronizar carrito:', error.message);
        showToast('danger', `Error al sincronizar el carrito con el servidor: ${error.message}`);
        throw error;
    }
}

// Obtener carrito del backend
async function loadCartFromBackend(userId) {
    try {
        const response = await fetch('/api/get_user_cart');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener carrito del servidor');
        }
        const data = await response.json();
        return { cart: data.cart, timestamp: data.timestamp };
    } catch (error) {
        console.error('Error al obtener carrito del backend:', error);
        return null;
    }
}

// Comparar timestamps para resolver conflictos
function isTimestampNewer(timestampA, timestampB) {
    if (!timestampA) return false;
    if (!timestampB) return true;
    return new Date(timestampA) > new Date(timestampB);
}

// Modal para resolver conflictos
function showConflictModal(localCart, localTimestamp, backendCart, backendTimestamp) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title">Conflicto de carrito detectado</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p>Se encontraron dos versiones del carrito:</p>
                        <p><strong>Local</strong> (Ãšltima actualizaciÃ³n: ${new Date(localTimestamp).toLocaleString('es-AR')}): ${localCart.items.length} Ã­tems, ${localCart.client ? 'con cliente' : 'sin cliente'}, ${localCart.quotation_id || 'sin presupuesto'}</p>
                        <p><strong>Servidor</strong> (Ãšltima actualizaciÃ³n: ${new Date(backendTimestamp).toLocaleString('es-AR')}): ${backendCart.items.length} Ã­tems, ${backendCart.client ? 'con cliente' : 'sin cliente'}, ${backendCart.quotation_id || 'sin presupuesto'}</p>
                        <p>Â¿CuÃ¡l deseas usar?</p>
                        <button class="btn btn-primary" id="chooseLocal">Usar carrito local</button>
                        <button class="btn btn-secondary" id="chooseBackend">Usar carrito del servidor</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        document.getElementById('chooseLocal').onclick = () => {
            resolve({ cart: localCart, timestamp: localTimestamp });
            bsModal.hide();
            modal.remove();
        };
        document.getElementById('chooseBackend').onclick = () => {
            resolve({ cart: backendCart, timestamp: backendTimestamp });
            bsModal.hide();
            modal.remove();
        };
        modal.addEventListener('hidden.bs.modal', () => {
            resolve({ cart: backendCart, timestamp: backendTimestamp }); // Por defecto, usar backend
            modal.remove();
        }, { once: true });
    });
}

// Inicializar IndexedDB y restaurar carrito
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initIndexedDB();
        const userId = await getUserId();

        if (!userId) {
            console.warn('Usuario no autenticado, inicializando carrito vacÃ­o');
            showToast('warning', 'Por favor, inicia sesiÃ³n para sincronizar el carrito');
            // Intentar cargar desde IndexedDB como respaldo
            const localData = await loadCartFromIndexedDB('anonymous');
            if (localData && localData.cart) {
                cart = localData.cart;
                cartObservations = cart.observations || '';
                const obsInput = document.getElementById("cartObservations");
                if (obsInput) obsInput.value = cartObservations;
                updateCartDisplay();
            }
            return;
        }

        // Priorizar siempre la versiÃ³n del servidor
        const backendData = await loadCartFromBackend(userId);
        if (backendData && backendData.cart) {
            cart = backendData.cart;
            await saveCartToIndexedDB(userId, cart, backendData.timestamp);
        } else {
            // Si el servidor no tiene datos, intentar cargar desde IndexedDB
            const localData = await loadCartFromIndexedDB(userId);
            if (localData && localData.cart) {
                cart = localData.cart;
                const timestamp = new Date().toISOString();
                await syncCartWithBackend(userId, cart, timestamp);
            } else {
                // Si no hay datos locales, usar carrito vacÃ­o
                cart = { items: [], client: null, quotation_id: null, type: 'new', observations: '' };
                const timestamp = new Date().toISOString();
                await saveCartToIndexedDB(userId, cart, timestamp);
                await syncCartWithBackend(userId, cart, timestamp);
            }
        }

        cartObservations = cart.observations || '';
        const obsInput = document.getElementById("cartObservations");
        if (obsInput) obsInput.value = cartObservations;
        updateCartDisplay();
    } catch (error) {
        console.error('Error al inicializar el carrito:', error);
        showToast('danger', 'Error al cargar el carrito');
        // Usar carrito vacÃ­o como Ãºltima opciÃ³n
        cart = { items: [], client: null, quotation_id: null, type: 'new', observations: '' };
        cartObservations = '';
        const obsInputFallback = document.getElementById("cartObservations");
        if (obsInputFallback) obsInputFallback.value = cartObservations;
        updateCartDisplay();
    }
});

/***************************************
 * Archivo: scripts.js
 * DescripciÃ³n: GestiÃ³n de filtros, paginaciÃ³n,
 * visualizaciÃ³n de imÃ¡genes, carga dinÃ¡mica de productos
 * y funcionalidad del botÃ³n flotante de WhatsApp.
 ***************************************/
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded, initializing components');

  // WhatsApp Button Dragging and Functionality
  const whatsappBtn = document.getElementById('whatsappBtn');
  if (whatsappBtn) {
    console.log('WhatsApp button found, setting up drag and click events');
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;
    let touchStartTime = 0;
    let mouseStartTime = 0;
    const TOUCH_THRESHOLD = 200; // Tiempo en ms para distinguir clic de arrastre
    const MOVE_THRESHOLD = 5; // Umbral de movimiento en pÃ­xeles para considerar arrastre
    const EDGE_MARGIN = 5; // Margen en pÃ­xeles desde los bordes del viewport

    // Load saved position from localStorage
    const savedPosition = localStorage.getItem('whatsappBtnPosition');
    if (savedPosition) {
      const { top, left } = JSON.parse(savedPosition);
      whatsappBtn.style.top = `${top}px`;
      whatsappBtn.style.left = `${left}px`;
      whatsappBtn.style.bottom = 'auto';
      whatsappBtn.style.right = 'auto';
      currentX = left;
      currentY = top;
      console.log('Restored WhatsApp button position:', { top, left });
    } else {
      console.log('No saved position found, using default position');
      currentX = EDGE_MARGIN; // Default left: 5px
      currentY = window.innerHeight - 60 - EDGE_MARGIN; // Default bottom: 20px, height: 60px
      whatsappBtn.style.left = `${currentX}px`;
      whatsappBtn.style.top = `${currentY}px`;
    }

    // Mouse events for dragging
    whatsappBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      initialX = e.clientX - currentX;
      initialY = e.clientY - currentY;
      mouseStartTime = Date.now();
      isDragging = false;
      console.log('Mouse down on WhatsApp button', { initialX, initialY, currentX, currentY });
      document.addEventListener('mousemove', onMouseDragging);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseDragging(e) {
      e.preventDefault();
      const deltaX = Math.abs(e.clientX - (initialX + currentX));
      const deltaY = Math.abs(e.clientY - (initialY + currentY));
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        isDragging = true;
        whatsappBtn.classList.add('dragging');
        requestAnimationFrame(() => {
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;

          // Constrain within viewport with margin
          const rect = whatsappBtn.getBoundingClientRect();
          const maxX = window.innerWidth - rect.width - EDGE_MARGIN;
          const maxY = window.innerHeight - rect.height - EDGE_MARGIN;
          currentX = Math.max(EDGE_MARGIN, Math.min(currentX, maxX));
          currentY = Math.max(EDGE_MARGIN, Math.min(currentY, maxY));

          whatsappBtn.style.left = `${currentX}px`;
          whatsappBtn.style.top = `${currentY}px`;
          whatsappBtn.style.right = 'auto';
          whatsappBtn.style.bottom = 'auto';
          console.log('Dragging WhatsApp button (mouse)', { currentX, currentY });
        });
      }
    }

    function onMouseUp(e) {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseDragging);
      document.removeEventListener('mouseup', onMouseUp);
      const duration = Date.now() - mouseStartTime;
      if (isDragging) {
        whatsappBtn.classList.remove('dragging');
        localStorage.setItem('whatsappBtnPosition', JSON.stringify({
          top: parseFloat(whatsappBtn.style.top || 0),
          left: parseFloat(whatsappBtn.style.left || 0)
        }));
        console.log('Stopped dragging, saved position:', {
          top: whatsappBtn.style.top,
          left: whatsappBtn.style.left
        });
      } else if (duration < TOUCH_THRESHOLD) {
        console.log('Mouse up detected as click, triggering enviarWhatsApp');
        enviarWhatsApp();
      }
      isDragging = false;
    }

    // Touch events for mobile
    whatsappBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.touches[0];
      initialX = touch.clientX - currentX;
      initialY = touch.clientY - currentY;
      touchStartTime = Date.now();
      isDragging = false;
      console.log('Touch start on WhatsApp button', { initialX, initialY, currentX, currentY });
      document.addEventListener('touchmove', onTouchDragging);
      document.addEventListener('touchend', onTouchEnd);
    });

    function onTouchDragging(e) {
      e.preventDefault();
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - (initialX + currentX));
      const deltaY = Math.abs(touch.clientY - (initialY + currentY));
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        isDragging = true;
        whatsappBtn.classList.add('dragging');
        requestAnimationFrame(() => {
          currentX = touch.clientX - initialX;
          currentY = touch.clientY - initialY;

          // Constrain within viewport with margin
          const rect = whatsappBtn.getBoundingClientRect();
          const maxX = window.innerWidth - rect.width - EDGE_MARGIN;
          const maxY = window.innerHeight - rect.height - EDGE_MARGIN;
          currentX = Math.max(EDGE_MARGIN, Math.min(currentX, maxX));
          currentY = Math.max(EDGE_MARGIN, Math.min(currentY, maxY));

          whatsappBtn.style.left = `${currentX}px`;
          whatsappBtn.style.top = `${currentY}px`;
          whatsappBtn.style.right = 'auto';
          whatsappBtn.style.bottom = 'auto';
          console.log('Dragging WhatsApp button (touch)', { currentX, currentY });
        });
      }
    }

    function onTouchEnd(e) {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('touchmove', onTouchDragging);
      document.removeEventListener('touchend', onTouchEnd);
      const touchDuration = Date.now() - touchStartTime;
      if (isDragging) {
        whatsappBtn.classList.remove('dragging');
        localStorage.setItem('whatsappBtnPosition', JSON.stringify({
          top: parseFloat(whatsappBtn.style.top || 0),
          left: parseFloat(whatsappBtn.style.left || 0)
        }));
        console.log('Stopped touch dragging, saved position:', {
          top: whatsappBtn.style.top,
          left: whatsappBtn.style.left
        });
      } else if (touchDuration < TOUCH_THRESHOLD) {
        console.log('Touch end detected as tap, triggering enviarWhatsApp');
        enviarWhatsApp();
      }
      isDragging = false;
    }

    // WhatsApp Message Functionality
    function enviarWhatsApp() {
      console.log('enviarWhatsApp called');
      const modalElement = document.getElementById('whatsappModal');
      if (!modalElement) {
        console.error('Error: No se encontrÃ³ el elemento whatsappModal');
        showToast('danger', 'No se pudo abrir el formulario de WhatsApp.');
        return;
      }

      // Limpiar campos y errores
      const numberInput = document.getElementById('whatsappNumber');
      const messageInput = document.getElementById('whatsappMessage');
      const errorElement = document.getElementById('whatsappNumberError');
      numberInput.value = '';
      messageInput.value = '';
      errorElement.style.display = 'none';

      // Inicializar modal de Bootstrap
      const modal = new bootstrap.Modal(modalElement);
      modal.show();

      // Enfocar el campo de nÃºmero
      numberInput.focus();

      // Manejar envÃ­o
      const submitButton = document.getElementById('whatsappSubmit');
      const handleSubmit = () => {
        const numero = numberInput.value.trim();
        const mensaje = messageInput.value.trim();

        // Validar nÃºmero
        if (!numero || !/^\d{6,}$/.test(numero)) {
          errorElement.textContent = 'NÃºmero invÃ¡lido. Debe tener al menos 6 dÃ­gitos y contener solo nÃºmeros.';
          errorElement.style.display = 'block';
          numberInput.focus();
          return;
        }

        // Generar enlace de WhatsApp
        const link = `https://api.whatsapp.com/send/?phone=549${numero}&text=${encodeURIComponent(mensaje)}&type=phone_number&app_absent=0`;
        console.log('Opening WhatsApp link:', link);
        window.open(link, '_blank');

        // Cerrar modal
        modal.hide();
        submitButton.removeEventListener('click', handleSubmit);
      };

      // Agregar listener para el botÃ³n de envÃ­o
      submitButton.addEventListener('click', handleSubmit);

      // Permitir envÃ­o con Enter en el campo de nÃºmero
      numberInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      });

      // Limpiar listener al cerrar el modal
      modalElement.addEventListener('hidden.bs.modal', () => {
        submitButton.removeEventListener('click', handleSubmit);
      }, { once: true });
    }

    // Verificar si Font Awesome estÃ¡ cargado
    if (!document.querySelector('i.fa-brands.fa-whatsapp')) {
      console.warn('Font Awesome WhatsApp icon not found, relying on fallback text');
    }
  } else {
    console.error('WhatsApp button not found in DOM');
  }
});

/* === POS: Utilidades de moneda y helpers === */
function moneyAR(n) {
  const v = Number(n || 0);
  try { return v.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }); }
  catch { return `$ ${v.toFixed(2)}`; }
}
function clamp(v, min, max) { return Math.min(Math.max(Number(v||0), min), max); }

/* Estructura base del carrito si no existiera en tu app */
window.cart = window.cart || {
  items: [], client: null, quotation_id: null, type: 'new', observations: '',
  desc: { porcentaje: 0, monto: 0, motivo: '' },
  log: { tipo: 'retiro', sucursal: 'Central', fecha: '', direccion: '', costo: 0, obs: '' },
  pagos: []
};

/* === POS: CÃ¡lculo de totales === */
function calcularTotalesPOS() {
  const items = cart.items || [];
  let subtotal = 0, impuestos = 0, peso = 0, unidades = 0;

  items.forEach(it => {
    const precio = Number(it.price || it.precio || it.precio_unit || it.precio_final_con_descuento || 0);
    const iva = Number(it.iva || it.vat || it.tax || 21);
    const cant = Number(it.quantity || it.cantidad || 1);
    const ptotal = precio * cant;
    subtotal += ptotal;
    impuestos += ptotal * (iva / 100);
    peso += Number(it.pesoKg || 0) * cant;
    unidades += cant;
  });

  const descPct = Number(cart.desc?.porcentaje || 0);
  const descMonto = Number(cart.desc?.monto || 0);
  const descuentos = (subtotal * (descPct / 100)) + descMonto;

  const costoEnvio = Number(cart.log?.costo || 0);
  const total = Math.max(0, subtotal - descuentos + impuestos + costoEnvio);

  return { subtotal, descuentos, impuestos, costoEnvio, total, peso, unidades };
}

/* === POS: Render del carrito === */
function renderCartOffcanvas() {
  const list = document.getElementById("listCarrito");
  if (!list) return;

  list.innerHTML = "";
  const items = cart.items || [];

  if (!items.length) {
    list.innerHTML = `<div class="list-group-item">No hay productos en el carrito.</div>`;
  } else {
    items.forEach((it, idx) => {
      const id = String(it.id || it.product_id || it.numero_producto || idx);
      const nombre = it.name || it.nombre || it.nombre_producto || `Item ${id}`;
      const iva = Number(it.iva || it.tax || 21);
      const precio = Number(it.price || it.precio || it.precio_unit || it.precio_final_con_descuento || 0);
      const cantidad = Number(it.quantity || it.cantidad || 1);
      const multiplo = Number(it.multiplo || 1);
      const unidad = it.unidad || it.unidad_medida || "Un";

      const row = document.createElement("div");
      row.className = "list-group-item d-flex justify-content-between align-items-start";
      row.innerHTML = `
        <div class="me-2">
          <div class="fw-medium">${nombre}</div>
          <div class="small text-secondary">IVA ${iva}% â€¢ ${moneyAR(precio)} â€¢ ${unidad}</div>
          <div class="d-flex align-items-center gap-2 mt-1">
            <input type="number" class="form-control form-control-sm" value="${cantidad}" min="0" step="${multiplo}" style="width: 90px">
            <span class="small">${moneyAR(precio * cantidad)}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-outline-danger btn-sm"><i class="bi bi-trash"></i></button>
        </div>
      `;
      list.appendChild(row);

      const [inputCant, btnDel] = row.querySelectorAll("input,button");
      inputCant.addEventListener("change", (e) => setCantidadPOS(idx, e.target.value));
      btnDel.addEventListener("click", () => removeFromCartPOS(idx));
    });
  }

  const t = calcularTotalesPOS();
  document.getElementById("totSubtotal").textContent = moneyAR(t.subtotal);
  document.getElementById("totDescuentos").textContent = moneyAR(t.descuentos);
  document.getElementById("totImpuestos").textContent = moneyAR(t.impuestos);
  document.getElementById("totEnvio").textContent = moneyAR(t.costoEnvio);
  document.getElementById("totTotal").textContent = moneyAR(t.total);
  document.getElementById("totPeso").textContent = `${(t.peso || 0).toFixed(2)} kg / ${t.unidades}`;

  // Actualiza flotante existente (index.html)
  const count = items.reduce((a, b) => a + Number(b.quantity || b.cantidad || 1), 0);
  document.getElementById("cartItemCount") && (document.getElementById("cartItemCount").textContent = count);
  document.getElementById("cartTotalFloat") && (document.getElementById("cartTotalFloat").textContent = (t.total || 0).toFixed(2));
  document.getElementById("cartClientFloat") && (document.getElementById("cartClientFloat").textContent = (cart.client?.name || "Sin cliente"));

  // Simulador
  document.getElementById("simTotal") && (document.getElementById("simTotal").textContent = moneyAR(t.total));
  actualizarRestanteSimuladorPOS();
}

function setCantidadPOS(idx, valor) {
  const cant = clamp(valor, 0, 9999);
  cart.items[idx].quantity = cant;
  renderCartOffcanvas();
}

function removeFromCartPOS(idx) {
  cart.items.splice(idx, 1);
  renderCartOffcanvas();
}

/* === POS: Descuentos === */
function aplicarDescuentoPOS() {
  const p = Number(document.getElementById("descPorcentaje").value || 0);
  const m = Number(document.getElementById("descMonto").value || 0);
  cart.desc = { porcentaje: clamp(p, 0, 100), monto: Math.max(0, m), motivo: (document.getElementById("descMotivo").value || "").trim() };
  renderCartOffcanvas();
  bootstrap.Modal.getOrCreateInstance("#modalDescuentos").hide();
}

/* === POS: LogÃ­stica === */
function aplicarLogisticaPOS() {
  cart.log = {
    tipo: document.getElementById("logTipoEntrega").value,
    sucursal: document.getElementById("logSucursal").value,
    fecha: document.getElementById("logFecha").value,
    direccion: (document.getElementById("logDireccion").value || document.getElementById("logDireccionInputMirror")?.value || "").trim(),
    costo: Number(document.getElementById("logCosto").value || 0),
    obs: (document.getElementById("logObs").value || "").trim()
  };
  renderCartOffcanvas();
  bootstrap.Modal.getOrCreateInstance("#modalLogistica").hide();
}

/* === POS: Simulador de pagos (modal) === */
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
function renderSimuladorPagosPOS() {
  const cont = document.getElementById("contenedorPagos");
  if (!cont) return;
  cont.innerHTML = "";
  (cart.pagos || []).forEach((pago, idx) => {
    const row = document.createElement("div");
    row.className = "card border-0 shadow-sm";
    row.innerHTML = `
      <div class="card-body row g-2 align-items-end">
        <div class="col-12 col-md-3">
          <label class="form-label">Medio</label>
          <select class="form-select tipo">${tiposPagoOptionsHTML()}</select>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">Monto</label>
          <input type="number" class="form-control monto" min="0" step="0.01" value="${pago.monto||0}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">InterÃ©s %</label>
          <input type="number" class="form-control interes" min="0" step="0.01" value="${pago.interes||0}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">Cuotas</label>
          <input type="number" class="form-control cuotas" min="1" step="1" value="${pago.cuotas||1}">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label">Tarjeta</label>
          <select class="form-select tarjeta">${tarjetasCreditoOptionsHTML()}</select>
        </div>
        <div class="col-12 col-md-1 d-grid">
          <button class="btn btn-outline-danger rem"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
    cont.appendChild(row);

    row.querySelector(".tipo").value = pago.tipo || "efectivo";
    row.querySelector(".tarjeta").value = pago.tarjeta || "";

    row.querySelector(".tipo").addEventListener("change", (e) => { pago.tipo = e.target.value; actualizarRestanteSimuladorPOS(); });
    row.querySelector(".monto").addEventListener("input", (e) => { pago.monto = Number(e.target.value||0); actualizarRestanteSimuladorPOS(); });
    row.querySelector(".interes").addEventListener("input", (e) => { pago.interes = Number(e.target.value||0); actualizarRestanteSimuladorPOS(); });
    row.querySelector(".cuotas").addEventListener("input", (e) => { pago.cuotas = clamp(e.target.value,1,60); actualizarRestanteSimuladorPOS(); });
    row.querySelector(".tarjeta").addEventListener("change", (e) => { pago.tarjeta = e.target.value; });
    row.querySelector(".rem").addEventListener("click", () => { cart.pagos.splice(idx,1); renderSimuladorPagosPOS(); });
  });
  actualizarRestanteSimuladorPOS();
}
function actualizarRestanteSimuladorPOS() {
  const t = calcularTotalesPOS().total;
  const pagado = (cart.pagos||[]).reduce((acc,p)=> acc + (Number(p.monto)||0) * (1 + Number(p.interes||0)/100), 0);
  const rest = Math.max(0, t - pagado);
  const el = document.getElementById("simRestante");
  if (el) el.textContent = moneyAR(rest);
}
function agregarFilaPagoPOS() { cart.pagos = cart.pagos || []; cart.pagos.push({ tipo:"efectivo", monto:0, cuotas:1, tarjeta:"", interes:0 }); renderSimuladorPagosPOS(); }
function limpiarPagosPOS() { cart.pagos = []; renderSimuladorPagosPOS(); }
function confirmarSimulacionPagosPOS() {
  const t = calcularTotalesPOS().total;
  const pagado = (cart.pagos||[]).reduce((a,p)=> a + (Number(p.monto)||0) * (1 + Number(p.interes||0)/100), 0);
  if (pagado + 0.01 < t) {
    if (!confirm("El total ingresado no cubre el monto a pagar. Â¿Continuar igualmente?")) return;
  }
  bootstrap.Modal.getOrCreateInstance("#modalPagos").hide();
}

/* === POS: Presupuesto e inicio de facturaciÃ³n (front) === */
function imprimirPresupuestoPOS() {
  const t = calcularTotalesPOS();
  const html = `
  <html><head><meta charset="utf-8"><title>Presupuesto</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial; margin:24px;}
    h1{margin:0 0 8px 0}.small{color:#666}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}
    .totales{margin-top:16px;width:100%}
    .totales td{padding:4px}.right{text-align:right}
  </style></head><body>
  <h1>Presupuesto</h1>
  <div class="small">Cliente: ${cart.client?.name || "Consumidor final"}</div>
  <div class="small">Fecha: ${new Date().toLocaleString("es-AR")}</div>
  <table><thead><tr><th>Producto</th><th>Cant</th><th>Precio</th><th>IVA</th><th>Total</th></tr></thead><tbody>
    ${
      (cart.items||[]).map(it=>{
        const precio = Number(it.price || it.precio || it.precio_unit || it.precio_final_con_descuento || 0);
        const iva = Number(it.iva || it.tax || 21);
        const unidad = it.unidad || it.unidad_medida || it.unidadMedida || "Un";
        const cant = Number(it.quantity || it.cantidad || 1);
        const cantStr = isUnidadM2(unidad) ? Number(cant).toFixed(2) : String(Number(cant).toFixed(0));
        return `<tr><td>${it.name || it.nombre || it.nombre_producto || "-"}</td><td>${cantStr}</td><td>${moneyAR(precio)}</td><td>${iva}%</td><td>${moneyAR(precio*cant)}</td></tr>`;
      }).join("")
    }
  </tbody></table>
  <table class="totales">
    <tr><td>Subtotal</td><td class="right">${moneyAR(t.subtotal)}</td></tr>
    <tr><td>Descuentos</td><td class="right">-${moneyAR(t.descuentos)}</td></tr>
    <tr><td>Impuestos</td><td class="right">${moneyAR(t.impuestos)}</td></tr>
    <tr><td>Costo envÃ­o</td><td class="right">${moneyAR(t.costoEnvio)}</td></tr>
    <tr><td><strong>Total</strong></td><td class="right"><strong>${moneyAR(t.total)}</strong></td></tr>
  </table>
  <p class="small">LogÃ­stica: ${cart.log?.tipo} â€¢ ${cart.log?.sucursal} â€¢ ${cart.log?.direccion || ""}</p>
  <p class="small">Motivo descuento: ${cart.desc?.motivo || "-"}</p>
  <script>window.print();</script>
  </body></html>`;
  const w = window.open("", "_blank");
  w.document.open(); w.document.write(html); w.document.close();
}

function facturarPOS() {
  if (!(cart.items||[]).length) { alert("El carrito estÃ¡ vacÃ­o."); return; }
  const payload = {
    cliente: cart.client,
    items: (cart.items||[]).map(it => ({
      id: it.id || it.product_id || it.numero_producto,
      nombre: it.name || it.nombre || it.nombre_producto,
      cantidad: it.quantity || it.cantidad || 1,
      precio_unit: it.price || it.precio || it.precio_unit || it.precio_final_con_descuento || 0,
      iva: it.iva || it.tax || 21,
      unidad: it.unidad || it.unidad_medida || "Un"
    })),
    descuentos: cart.desc || { porcentaje:0, monto:0, motivo:"" },
    logistica: cart.log || {},
    pagos: cart.pagos || [],
    totales: calcularTotalesPOS(),
    metadata: { origen: "pos-web", fecha: new Date().toISOString() }
  };
  console.log("Payload FacturaciÃ³n POS:", payload); // <-- Conecta aquÃ­ con tu endpoint (fetch)
  alert("Factura lista para enviar (ver consola).");
}

/* === POS: Hook de UI y eventos === */
function toggleCart() {
  const off = bootstrap.Offcanvas.getOrCreateInstance("#offCarrito");
  renderCartOffcanvas();
  off.toggle();
}

// Botones del carrito y modales
document.getElementById("btnLimpiarCliente")?.addEventListener("click", () => {
  cart.client = null;
  document.getElementById("lblCliente").textContent = "Consumidor final";
  renderCartOffcanvas();
});
document.getElementById("btnAplicarDescuento")?.addEventListener("click", aplicarDescuentoPOS);
document.getElementById("btnAplicarLogistica")?.addEventListener("click", aplicarLogisticaPOS);
document.getElementById("btnAgregarPago")?.addEventListener("click", agregarFilaPagoPOS);
document.getElementById("btnLimpiarPagos")?.addEventListener("click", limpiarPagosPOS);
document.getElementById("btnConfirmarPagos")?.addEventListener("click", confirmarSimulacionPagosPOS);
document.getElementById("btnPresupuesto")?.addEventListener("click", imprimirPresupuestoPOS);
document.getElementById("btnFacturar")?.addEventListener("click", facturarPOS);

// Cuando abras el modal de pagos, asegurar render
document.getElementById("modalPagos")?.addEventListener("shown.bs.modal", renderSimuladorPagosPOS);

/* === POS: Dirección de logística (selección y edición) === */
(function initLogisticaDireccion() {
  const modal = document.getElementById('modalLogistica');
  if (!modal) return;

  function getClientAddresses() {
    const c = cart.client || {};
    let addrs = [];
    if (Array.isArray(c.addresses)) addrs = c.addresses.slice();
    else if (Array.isArray(c.direcciones)) addrs = c.direcciones.slice();
    else if (Array.isArray(c.domicilios)) addrs = c.domicilios.slice();
    else if (c.direccion_completa) addrs = [c.direccion_completa];
    else if (c.direccion) addrs = [c.direccion];
    // Normalizar a strings
    return addrs.map(a => typeof a === 'string' ? a : (a?.texto || a?.full || a?.direccion || ''))
                .filter(s => (s||'').trim().length > 0);
  }

  function ensureUI() {
    let section = document.getElementById('logisticaDireccionSection');
    // Si no existe el bloque, crearlo dinámicamente después del input legacy
    if (!section) {
      const legacyWrap = document.getElementById('logDireccion')?.parentElement;
      if (legacyWrap && legacyWrap.parentElement) {
        section = document.createElement('div');
        section.className = 'col-12';
        section.id = 'logisticaDireccionSection';
        section.style.display = 'none';
        section.innerHTML = `
          <label class="form-label" for="logDireccionSelect">Dirección de entrega</label>
          <div class="row g-2 align-items-center">
            <div class="col-12 col-md-6">
              <select id="logDireccionSelect" class="form-select">
                <option value="">Elegir dirección…</option>
              </select>
            </div>
            <div class="col-12 col-md-6 d-flex gap-2">
              <input id="logDireccionInputMirror" type="text" class="form-control" placeholder="Calle, número, ciudad, CP">
              <button type="button" id="btnEditarDireccion" class="btn btn-outline-secondary">Editar</button>
            </div>
          </div>
          <div id="logDireccionEditor" class="mt-3" style="display:none;">
            <div class="row g-2">
              <div class="col-12 col-md-6">
                <label class="form-label">Calle</label>
                <input type="text" id="dirCalle" class="form-control" placeholder="Calle">
              </div>
              <div class="col-6 col-md-2">
                <label class="form-label">Número</label>
                <input type="text" id="dirNumero" class="form-control" placeholder="Número">
              </div>
              <div class="col-6 col-md-4">
                <label class="form-label">Ciudad</label>
                <input type="text" id="dirCiudad" class="form-control" placeholder="Ciudad">
              </div>
              <div class="col-6 col-md-4">
                <label class="form-label">Provincia</label>
                <input type="text" id="dirProvincia" class="form-control" placeholder="Provincia">
              </div>
              <div class="col-6 col-md-2">
                <label class="form-label">CP</label>
                <input type="text" id="dirCP" class="form-control" placeholder="CP">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Referencia</label>
                <input type="text" id="dirReferencia" class="form-control" placeholder="Piso, dpto, referencias">
              </div>
            </div>
            <div class="mt-2 d-flex gap-2">
              <button type="button" id="btnGuardarDireccionEdit" class="btn btn-primary">Guardar cambios</button>
              <button type="button" id="btnCancelarDireccionEdit" class="btn btn-outline-secondary">Cancelar</button>
            </div>
          </div>`;
        legacyWrap.parentElement.insertBefore(section, legacyWrap.nextSibling);
        // Re-conectar handlers que dependen de estos IDs (simplemente volver a adjuntar)
        document.getElementById('btnEditarDireccion')?.addEventListener('click', function(){
          const editor = document.getElementById('logDireccionEditor');
          if (!editor) return;
          editor.style.display = '';
          const mirror = document.getElementById('logDireccionInputMirror');
          const txt = mirror?.value || '';
          const parts = (txt || '').split(',').map(s => s.trim());
          document.getElementById('dirCalle').value = parts[0] || '';
          document.getElementById('dirNumero').value = (parts[1] || '').replace(/[^0-9]/g,'');
          document.getElementById('dirCiudad').value = parts[2] || '';
          document.getElementById('dirProvincia').value = parts[3] || '';
          document.getElementById('dirCP').value = (parts[4] || '').replace(/[^0-9]/g,'');
          document.getElementById('dirReferencia').value = '';
        });
        document.getElementById('btnCancelarDireccionEdit')?.addEventListener('click', function(){
          const editor = document.getElementById('logDireccionEditor');
          if (editor) editor.style.display = 'none';
        });
        document.getElementById('btnGuardarDireccionEdit')?.addEventListener('click', function(){
          function val(id){ return (document.getElementById(id)?.value || '').trim(); }
          const calle = val('dirCalle');
          const numero = val('dirNumero');
          const ciudad = val('dirCiudad');
          const provincia = val('dirProvincia');
          const cp = val('dirCP');
          const ref = val('dirReferencia');
          const parts = [];
          if (calle) parts.push(calle + (numero? ' ' + numero : ''));
          if (ciudad) parts.push(ciudad);
          if (provincia) parts.push(provincia);
          if (cp) parts.push(cp);
          const txt = parts.join(', ') + (ref? ` - ${ref}` : '');
          const mirror = document.getElementById('logDireccionInputMirror');
          if (mirror) mirror.value = txt;
          const legacy = document.getElementById('logDireccion');
          if (legacy) legacy.value = txt;
          const sel = document.getElementById('logDireccionSelect');
          if (sel && sel.value !== '') {
            sel.options[sel.selectedIndex].textContent = txt || '(sin dirección)';
            if (!cart.client) cart.client = {};
            if (!Array.isArray(cart.client.addresses)) cart.client.addresses = getClientAddresses();
            const idx = Number(sel.value);
            if (!isNaN(idx)) cart.client.addresses[idx] = txt;
          }
          const editor = document.getElementById('logDireccionEditor');
          if (editor) editor.style.display = 'none';
        });
        document.getElementById('logDireccionSelect')?.addEventListener('change', function(){
          const idx = this.value;
          const addrs = getClientAddresses();
          const txt = (idx === '' ? '' : (addrs[Number(idx)] || ''));
          const mirror = document.getElementById('logDireccionInputMirror');
          if (mirror) mirror.value = txt;
          const legacy = document.getElementById('logDireccion');
          if (legacy) legacy.value = txt;
        });
      }
    }
    const tipo = document.getElementById('logTipoEntrega');
    if (!tipo) return;
    const isEnvio = (tipo.value === 'envio');
    if (section) section.style.display = isEnvio ? '' : 'none';
    // Mantener input clásico visible solo si no es envío
    const legacy = document.getElementById('logDireccion');
    if (legacy) legacy.parentElement.style.display = isEnvio ? 'none' : '';
    if (!isEnvio) return;

    // Poblar select
    const sel = document.getElementById('logDireccionSelect');
    const mirror = document.getElementById('logDireccionInputMirror');
    if (!sel || !mirror) return;
    const options = getClientAddresses();
    sel.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = 'Elegir dirección…'; sel.appendChild(opt0);
    options.forEach((txt, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = txt; sel.appendChild(o); });
    // Por defecto, no seleccionar ninguna; forzar elección del usuario
    mirror.value = '';
  }

  modal.addEventListener('shown.bs.modal', ensureUI);

  document.getElementById('logTipoEntrega')?.addEventListener('change', ensureUI);

  document.getElementById('logDireccionSelect')?.addEventListener('change', function () {
    const sel = this;
    const idx = sel.value;
    const addrs = getClientAddresses();
    const txt = (idx === '' ? '' : (addrs[Number(idx)] || ''));
    const mirror = document.getElementById('logDireccionInputMirror');
    if (mirror) mirror.value = txt;
    // Sincronizar con input clásico para compatibilidad
    const legacy = document.getElementById('logDireccion');
    if (legacy) legacy.value = txt;
  });

  // Editor de dirección
  document.getElementById('btnEditarDireccion')?.addEventListener('click', function(){
    const editor = document.getElementById('logDireccionEditor');
    if (!editor) return;
    editor.style.display = '';
    const mirror = document.getElementById('logDireccionInputMirror');
    const txt = mirror?.value || '';
    // Relleno heurístico básico a partir de comas
    const parts = (txt || '').split(',').map(s => s.trim());
    document.getElementById('dirCalle').value = parts[0] || '';
    document.getElementById('dirNumero').value = (parts[1] || '').replace(/[^0-9]/g,'');
    document.getElementById('dirCiudad').value = parts[2] || '';
    document.getElementById('dirProvincia').value = parts[3] || '';
    document.getElementById('dirCP').value = (parts[4] || '').replace(/[^0-9]/g,'');
    document.getElementById('dirReferencia').value = '';
  });

  document.getElementById('btnCancelarDireccionEdit')?.addEventListener('click', function(){
    const editor = document.getElementById('logDireccionEditor');
    if (editor) editor.style.display = 'none';
  });

  document.getElementById('btnGuardarDireccionEdit')?.addEventListener('click', function(){
    function val(id){ return (document.getElementById(id)?.value || '').trim(); }
    const calle = val('dirCalle');
    const numero = val('dirNumero');
    const ciudad = val('dirCiudad');
    const provincia = val('dirProvincia');
    const cp = val('dirCP');
    const ref = val('dirReferencia');
    const parts = [];
    if (calle) parts.push(calle + (numero? ' ' + numero : ''));
    if (ciudad) parts.push(ciudad);
    if (provincia) parts.push(provincia);
    if (cp) parts.push(cp);
    const txt = parts.join(', ') + (ref? ` - ${ref}` : '');

    const mirror = document.getElementById('logDireccionInputMirror');
    if (mirror) mirror.value = txt;
    const legacy = document.getElementById('logDireccion');
    if (legacy) legacy.value = txt;

    // Actualizar opción seleccionada si corresponde
    const sel = document.getElementById('logDireccionSelect');
    if (sel && sel.value !== '') {
      sel.options[sel.selectedIndex].textContent = txt || '(sin dirección)';
      // Persistir en el objeto cliente para esta sesión
      if (!cart.client) cart.client = {};
      if (!Array.isArray(cart.client.addresses)) cart.client.addresses = getClientAddresses();
      const idx = Number(sel.value);
      if (!isNaN(idx)) cart.client.addresses[idx] = txt;
    }

    const editor = document.getElementById('logDireccionEditor');
    if (editor) editor.style.display = 'none';
  });
})();

// Refresca el nombre del cliente cuando lo elijas desde el modal existente
document.addEventListener("client-selected", (ev) => {
  cart.client = ev.detail;
  document.getElementById("lblCliente").textContent = cart.client?.name || "Consumidor final";
  renderCartOffcanvas();
});


