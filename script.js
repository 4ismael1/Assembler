// ============== FIREBASE CONFIGURATION ==============
const firebaseConfig = {
  apiKey: "AIzaSyDio2otlkTB_e8kPzjqXlls4_loAUn4Na4",
  authDomain: "assembler-70ea5.firebaseapp.com",
  projectId: "assembler-70ea5",
  storageBucket: "assembler-70ea5.appspot.com",
  messagingSenderId: "767001598828",
  appId: "1:767001598828:web:a69927c476898649803149",
  measurementId: "G-FS65PNQCZP"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============== GLOBAL APP STATE ==============
let currentUserCredits = 0;
let creditListenerUnsubscribe = null;
let slides = [];
let activeFiles = [];
let activeSlideIndex = 0;
let currentBaseColor = '#3498db'; // Default color
const CREDIT_PRICE = 0.5; // price per credit in chosen currency

// ============== DOM Elements ==============
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const presentationEditor = document.getElementById('presentation-editor');
const mainSlideView = document.getElementById('main-slide-view');
const slideThumbnailsContainer = document.getElementById('slide-thumbnails');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const aiCostDisplay = document.getElementById('ai-cost');
const bulkAiBtn = document.getElementById('bulk-ai-btn');
const themeColorPicker = document.getElementById('themeColorPicker');
const restyleBtn = document.getElementById('restyleBtn');
const folderContainer = document.getElementById('folder-container');
const startBtn = document.getElementById('startBtn');
const folderInput = document.getElementById('folderInput');
const appFooter = document.getElementById('app-footer');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const exportModal = document.getElementById('export-modal');
const exportPptxBtn = document.getElementById('export-pptx-btn');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const buyCreditsBtn = document.getElementById('buyCreditsBtn');
const creditsModal = document.getElementById('credits-modal');
const creditAmountInput = document.getElementById('creditAmount');
const creditTotalDisplay = document.getElementById('creditTotal');
const creditPriceDisplay = document.getElementById('creditPriceDisplay');
const confirmBuyCreditsBtn = document.getElementById('confirm-buy-credits-btn');
const closeCreditsModalBtn = document.getElementById('close-credits-modal-btn');
const layoutToggle = document.getElementById('layoutToggle');
const layoutToggleLabel = document.getElementById('layoutToggleLabel');

// Initialize the theme and interaction listeners on load
document.addEventListener('DOMContentLoaded', () => {
    updateTheme(currentBaseColor);
    setupInteractionListeners();

    creditPriceDisplay.textContent = CREDIT_PRICE.toFixed(2);
    updateCreditTotal();
});

// ============== AUTHENTICATION LOGIC ==============
const provider = new firebase.auth.GoogleAuthProvider();
provider.addScope('profile');
provider.addScope('email');

loginBtn.addEventListener('click', () => auth.signInWithPopup(provider).catch(handleAuthError));
logoutBtn.addEventListener('click', () => auth.signOut());

function handleAuthError(error) {
    console.error("Authentication error:", error.code, error.message);
    alert("Hubo un problema al iniciar sesión. Por favor, intenta de nuevo.");
}

auth.onAuthStateChanged(async user => {
    const isUserLoggedIn = !!user;
    document.getElementById('user-profile').classList.toggle('hidden', !isUserLoggedIn);
    document.getElementById('login-container').classList.toggle('hidden', isUserLoggedIn);
    document.getElementById('app-content').classList.toggle('hidden', !isUserLoggedIn);

    if (isUserLoggedIn) {
        document.getElementById('user-name').textContent = user.displayName;
        document.getElementById('user-photo').src = user.photoURL;
        await setupUserInFirestore(user);
        listenForCreditChanges(user.uid);
    } else {
        if (creditListenerUnsubscribe) creditListenerUnsubscribe();
        resetApp();
    }
    feather.replace();
});

async function setupUserInFirestore(user) {
    const userRef = db.collection('users').doc(user.uid);
    const doc = await userRef.get();
    if (!doc.exists) {
        try {
            await userRef.set({
                name: user.displayName, email: user.email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                credits: 10
            });
        } catch (error) { console.error("Error creating user:", error); }
    }
}

function listenForCreditChanges(userId) {
    if (creditListenerUnsubscribe) creditListenerUnsubscribe();
    const userRef = db.collection('users').doc(userId);
    creditListenerUnsubscribe = userRef.onSnapshot(doc => {
        if (doc.exists) {
            currentUserCredits = doc.data().credits;
            document.getElementById('user-credits').textContent = currentUserCredits;
            updateAiCostAndButton(); 
        }
    }, error => console.error("Error listening for credits:", error));
}


// ============== GEMINI API LOGIC ==============
async function generateCommentWithGemini(imageFile, slideTitle) {
    const apiKey = "AIzaSyB6dztMc4Sx108qyunxAKpXpIAEbFgl4Qo";
    if (!apiKey) {
        alert("La clave de API de Gemini no está configurada.");
        return null;
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const base64ImageData = await fileToBase64(imageFile, false); 
    const userPrompt = `Considerando el título: "${slideTitle}", describe la imagen de esta actividad escolar en un párrafo corto y positivo en español. Enfócate en la colaboración, aprendizaje o diversión.`;
    const payload = { contents: [{ role: "user", parts: [{ text: userPrompt }, { inlineData: { mimeType: imageFile.type, data: base64ImageData } }] }] };

    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Respuesta de la IA inesperada.");
        return text;
    } catch (error) {
        console.error("Error llamando a la API de Gemini:", error);
        alert("Hubo un problema al contactar la IA.");
        return null;
    }
}

// ============== APPLICATION LOGIC ==============
function showLoader(message) { 
    document.getElementById('loader-text').textContent = message; 
    document.getElementById('loader').classList.remove('hidden'); 
}
function hideLoader() { document.getElementById('loader').classList.add('hidden'); }

folderInput.addEventListener('change', e => {
    if (e.target.files.length > 0) {
        showLoader("Creando presentación...");
        activeFiles = [...e.target.files];
        
        const structure = organizarPorGradoYActividad(activeFiles);
        generarSlides(structure);
        renderPresentationView();

        folderContainer.classList.add('hidden');
        startBtn.classList.add('hidden');
        presentationEditor.classList.remove('hidden');
        appFooter.classList.remove('hidden');
        downloadBtn.classList.remove('hidden');
        resetBtn.classList.remove('hidden');
        hideLoader();
    }
});


function organizarPorGradoYActividad(files) {
    return files.reduce((acc, file) => {
        const pathParts = file.webkitRelativePath.split('/');
        if (pathParts.length > 2) {
            const grado = pathParts[pathParts.length - 3];
            const actividad = pathParts[pathParts.length - 2];
            if (!acc[grado]) acc[grado] = {};
            if (!acc[grado][actividad]) acc[grado][actividad] = [];
            acc[grado][actividad].push(file);
        }
        return acc;
    }, {});
}

function generarSlides(structure) {
    slides = [];
    for (const grado in structure) {
        for (const actividad in structure[grado]) {
            // UPDATED: Limit images to 4
            const fotos = structure[grado][actividad].sort(() => 0.5 - Math.random()).slice(0, 4);
            if (fotos.length > 0) {
                slides.push({ 
                    grado, 
                    actividad, 
                    imagenes: fotos, 
                    aiComment: '', 
                    needsAi: true, 
                    isSelectedForAi: true,
                    geometry: generateGeometricShapes(),
                    layoutStyle: 'overlap', // Default layout style
                    positions: {} // To store custom positions
                });
            }
        }
    }
}

function renderPresentationView() {
    slideThumbnailsContainer.innerHTML = '';
    slides.forEach((slide, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'sidebar-slide-item';
        thumb.dataset.slideIndex = index;
        const firstImage = slide.imagenes.length > 0 ? URL.createObjectURL(slide.imagenes[0]) : '';

        thumb.innerHTML = `
            <input type="checkbox" class="thumbnail-checkbox" data-slide-index="${index}" ${slide.isSelectedForAi ? 'checked' : ''} ${!slide.needsAi ? 'disabled' : ''}>
            <div class="thumbnail-preview" style="background-image: url('${firstImage}')"></div>
            <div class="thumbnail-info">
                <p>${slide.actividad}</p>
                <div class="ai-status">
                    ${!slide.needsAi ? '<span data-feather="star" class="icon" style="width:14px; height:14px;"></span> Potenciado' : ''}
                </div>
            </div>
        `;
        slideThumbnailsContainer.appendChild(thumb);
    });
    updateAiCostAndButton();
    activeSlideIndex = Math.max(0, Math.min(activeSlideIndex, slides.length - 1));
    displaySlide(activeSlideIndex);
    feather.replace();
}

function displaySlide(index) {
    activeSlideIndex = index;
    const slide = slides[index];
    if (!slide) return;

    // Update UI controls to match the current slide's state
    const isOverlap = slide.layoutStyle === 'overlap';
    layoutToggle.checked = isOverlap;
    layoutToggleLabel.textContent = isOverlap ? 'Collage Superpuesto' : 'Collage en Cuadrícula';

    const slideContent = document.createElement('div');
    slideContent.className = 'main-slide-content';
    
    const shapesContainer = document.createElement('div');
    slide.geometry.forEach(shape => {
        const shapeEl = document.createElement('div');
        shapeEl.className = 'geo-shape';
        Object.assign(shapeEl.style, shape.style);
        shapesContainer.appendChild(shapeEl);
    });

    const foregroundContainer = document.createElement('div');
    foregroundContainer.className = 'slide-foreground';
    
    const collageHTML = generateCollageLayout(slide, index);

    foregroundContainer.innerHTML = `
        <h2 contenteditable="true" data-slide-index="${index}">${slide.actividad} – ${slide.grado}</h2>
        ${collageHTML}
        <div class="ai-comment">${slide.aiComment}</div>
    `;

    slideContent.appendChild(shapesContainer);
    slideContent.appendChild(foregroundContainer);

    mainSlideView.innerHTML = ''; 
    mainSlideView.appendChild(slideContent);
    feather.replace();

    document.querySelectorAll('.sidebar-slide-item').forEach(thumb => {
        thumb.classList.toggle('active', parseInt(thumb.dataset.slideIndex) === index);
    });
}


function updateAiCostAndButton() {
    const selectedCount = slides.filter(s => s.isSelectedForAi && s.needsAi).length;
    aiCostDisplay.textContent = selectedCount;
    bulkAiBtn.disabled = selectedCount === 0 || selectedCount > currentUserCredits;
}

// --- EVENT LISTENERS ---
slideThumbnailsContainer.addEventListener('click', e => {
    const slideItem = e.target.closest('.sidebar-slide-item');
    if (slideItem) displaySlide(parseInt(slideItem.dataset.slideIndex));
});

slideThumbnailsContainer.addEventListener('change', e => {
    if (e.target.classList.contains('thumbnail-checkbox')) {
        slides[parseInt(e.target.dataset.slideIndex)].isSelectedForAi = e.target.checked;
        updateAiCostAndButton();
    }
});

mainSlideView.addEventListener('focusout', e => {
    if (e.target.tagName === 'H2') {
        const slideIndex = parseInt(e.target.dataset.slideIndex, 10);
        const newTitle = e.target.textContent;
        const parts = newTitle.split('–');
        slides[slideIndex].actividad = parts[0] ? parts[0].trim() : '';
        slides[slideIndex].grado = parts[1] ? parts[1].trim() : '';
        
        const thumbnail = slideThumbnailsContainer.querySelector(`[data-slide-index="${slideIndex}"] .thumbnail-info p`);
        if(thumbnail) thumbnail.textContent = slides[slideIndex].actividad;
    }
});

selectAllCheckbox.addEventListener('change', e => {
    slides.forEach(slide => { if (slide.needsAi) slide.isSelectedForAi = e.target.checked; });
    renderPresentationView();
});

themeColorPicker.addEventListener('input', e => {
    updateTheme(e.target.value);
});

layoutToggle.addEventListener('change', e => {
    const slide = slides[activeSlideIndex];
    if (slide) {
        const isOverlap = e.target.checked;
        slide.layoutStyle = isOverlap ? 'overlap' : 'grid';
        slide.positions = {}; // Reset custom positions when changing layout type

        // Update label text for clarity
        layoutToggleLabel.textContent = isOverlap ? 'Collage Superpuesto' : 'Collage en Cuadrícula';

        displaySlide(activeSlideIndex);
    }
});


restyleBtn.addEventListener('click', () => {
    if (slides[activeSlideIndex]) {
        slides[activeSlideIndex].geometry = generateGeometricShapes();
        displaySlide(activeSlideIndex);
    }
})

bulkAiBtn.addEventListener('click', async () => {
    const slidesToProcess = slides.filter(s => s.isSelectedForAi && s.needsAi);
    const totalCost = slidesToProcess.length;

    if (totalCost === 0 || totalCost > currentUserCredits) {
        alert(totalCost > 0 ? "No tienes suficientes créditos." : "No hay diapositivas seleccionadas para potenciar.");
        return;
    }

    showLoader(`Potenciando ${totalCost} diapositiva(s)...`);
    bulkAiBtn.disabled = true;

    for (const slide of slidesToProcess) {
        const slideTitle = `${slide.actividad} – ${slide.grado}`;
        const comment = await generateCommentWithGemini(slide.imagenes[0], slideTitle);
        if (comment) {
            slide.aiComment = comment;
            slide.needsAi = false;
            slide.isSelectedForAi = false;
        }
    }

    const userRef = db.collection('users').doc(auth.currentUser.uid);
    await userRef.update({ credits: firebase.firestore.FieldValue.increment(-totalCost) });

    hideLoader();
    renderPresentationView();
    displaySlide(activeSlideIndex);
});

buyCreditsBtn.addEventListener('click', () => {
    creditAmountInput.value = 10;
    updateCreditTotal();
    creditsModal.classList.add('show');
});

closeCreditsModalBtn.addEventListener('click', () => {
    creditsModal.classList.remove('show');
});

creditAmountInput.addEventListener('input', updateCreditTotal);

function updateCreditTotal() {
    const qty = parseInt(creditAmountInput.value, 10) || 0;
    const total = qty * CREDIT_PRICE;
    creditTotalDisplay.textContent = total.toFixed(2);
}

confirmBuyCreditsBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) {
        alert('Debes iniciar sesión para añadir créditos.');
        creditsModal.classList.remove('show');
        return;
    }

    const qty = parseInt(creditAmountInput.value, 10) || 0;
    if (qty <= 0) return;

    try {
        const userRef = db.collection('users').doc(user.uid);
        await userRef.update({
            credits: firebase.firestore.FieldValue.increment(qty)
        });

        const creditToast = document.getElementById('credit-toast');
        creditToast.textContent = `+${qty} Créditos añadidos!`;
        creditToast.classList.add('show');
        setTimeout(() => creditToast.classList.remove('show'), 3000);
        creditsModal.classList.remove('show');
    } catch (error) {
        console.error('Error adding credits:', error);
        alert('Hubo un problema al añadir los créditos.');
    }
});

resetBtn.addEventListener('click', resetApp);
function resetApp() {
    presentationEditor.classList.add('hidden');
    folderContainer.classList.remove('hidden');
    appFooter.classList.add('hidden');
    startBtn.classList.add('hidden');
    slides = [];
    activeFiles = [];
    folderInput.value = '';
    activeSlideIndex = 0;
}

// ============== EXPORT LOGIC ==============
downloadBtn.addEventListener('click', () => {
    exportModal.classList.add('show');
});

closeModalBtn.addEventListener('click', () => {
    exportModal.classList.remove('show');
});

exportPptxBtn.addEventListener('click', async () => {
    exportModal.classList.remove('show');
    showLoader('Generando archivo PPTX...');
    await generarPPTX();
    hideLoader();
});

exportPdfBtn.addEventListener('click', async () => {
    exportModal.classList.remove('show');
    showLoader('Generando archivo PDF...');
    await generarPDF();
    hideLoader();
});


// ============== UTILITY & EXPORT FUNCTIONS ==============

function fileToBase64(file, includeMime = true) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (includeMime) {
                resolve(reader.result);
            } else {
                resolve(reader.result.split(',')[1]);
            }
        };
        reader.onerror = error => reject(error);
    });
}

function generateGeometricShapes() {
    const shapes = [];
    const shapeCount = Math.floor(Math.random() * 5) + 5;
    for (let i = 0; i < shapeCount; i++) {
        const size = (Math.random() * 25 + 10) + '%';
        shapes.push({
            style: {
                width: size,
                height: size,
                top: (Math.random() * 90 - 10) + '%',
                left: (Math.random() * 90 - 10) + '%',
                transform: `rotate(${Math.random() * 360}deg)`,
                borderRadius: `${Math.random() * 50}%`,
                opacity: (Math.random() * 0.3 + 0.1).toFixed(2),
                backgroundColor: i % 2 === 0 ? 'var(--slide-accent1-color)' : 'var(--slide-accent2-color)'
            }
        });
    }
    return shapes;
}

function updateTheme(baseHex) {
    currentBaseColor = baseHex;
    const palette = generateColorPalette(baseHex);
    const root = document.documentElement;
    root.style.setProperty('--slide-bg-color', palette.bg);
    root.style.setProperty('--slide-title-color', palette.title);
    root.style.setProperty('--slide-text-color', palette.text);
    root.style.setProperty('--slide-comment-bg', palette.commentBg);
    root.style.setProperty('--slide-accent1-color', palette.accent1);
    root.style.setProperty('--slide-accent2-color', palette.accent2);
    if (slides.length > 0) {
        displaySlide(activeSlideIndex);
    }
}

// ============== NEW INTERACTION LOGIC (DRAG, PAN, DELETE) ==============

let activeDrag = {
    element: null,
    isPanning: false,
    startX: 0,
    startY: 0,
    initialLeft: 0,
    initialTop: 0,
    initialObjPosX: 50,
    initialObjPosY: 50
};

function setupInteractionListeners() {
    mainSlideView.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

function onDragStart(e) {
    const deleteBtn = e.target.closest('.delete-image-btn');
    if (deleteBtn) {
        e.stopPropagation(); // Prevent drag from starting
        const slideIndex = parseInt(deleteBtn.dataset.slideIndex, 10);
        const imgIndex = parseInt(deleteBtn.dataset.imgIndex, 10);
        
        slides[slideIndex].imagenes.splice(imgIndex, 1);
        delete slides[slideIndex].positions[imgIndex]; // Remove position data as well
        
        if (slides[slideIndex].imagenes.length === 0) {
            slides.splice(slideIndex, 1);
            activeSlideIndex = Math.max(0, slideIndex - 1);
            if (slides.length === 0) resetApp(); else renderPresentationView();
        } else {
            displaySlide(slideIndex);
            if (imgIndex === 0) renderPresentationView();
        }
        return;
    }

    const imageContainer = e.target.closest('.image-container');
    if (!imageContainer) return;

    if (e.target.tagName === 'IMG') {
        e.preventDefault();
        activeDrag.isPanning = true;
        activeDrag.element = e.target;
        
        const computedStyle = window.getComputedStyle(e.target);
        const [x, y] = computedStyle.objectPosition.split(' ').map(v => parseFloat(v));
        activeDrag.initialObjPosX = x;
        activeDrag.initialObjPosY = y;
    } else {
        e.preventDefault();
        activeDrag.isPanning = false;
        activeDrag.element = imageContainer;

        // if container is positioned by grid, convert to absolute for free movement
        if (!imageContainer.style.position || imageContainer.style.position !== 'absolute') {
            const rect = imageContainer.getBoundingClientRect();
            const parentRect = imageContainer.parentElement.getBoundingClientRect();
            imageContainer.style.position = 'absolute';
            imageContainer.style.top = `${rect.top - parentRect.top}px`;
            imageContainer.style.left = `${rect.left - parentRect.left}px`;
            imageContainer.style.width = `${rect.width}px`;
            imageContainer.style.height = `${rect.height}px`;
        }

        const computedStyle = window.getComputedStyle(imageContainer);
        activeDrag.initialLeft = parseFloat(computedStyle.left);
        activeDrag.initialTop = parseFloat(computedStyle.top);
        imageContainer.classList.add('dragging');
    }
    
    activeDrag.startX = e.clientX;
    activeDrag.startY = e.clientY;
}

function onDragMove(e) {
    if (!activeDrag.element) return;
    e.preventDefault();

    const deltaX = e.clientX - activeDrag.startX;
    const deltaY = e.clientY - activeDrag.startY;

    if (activeDrag.isPanning) {
        const img = activeDrag.element;
        const container = img.parentElement;
        
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const containerRatio = container.clientWidth / container.clientHeight;
        
        let imgDisplayWidth, imgDisplayHeight;
        if (imgRatio > containerRatio) {
            imgDisplayHeight = container.clientHeight;
            imgDisplayWidth = imgDisplayHeight * imgRatio;
        } else {
            imgDisplayWidth = container.clientWidth;
            imgDisplayHeight = imgDisplayWidth / imgRatio;
        }

        const panRangeX = imgDisplayWidth - container.clientWidth;
        const panRangeY = imgDisplayHeight - container.clientHeight;
        
        let newX = activeDrag.initialObjPosX;
        if (panRangeX > 0) {
            const moveX = (deltaX / panRangeX) * 100;
            newX = activeDrag.initialObjPosX - moveX;
        }
        
        let newY = activeDrag.initialObjPosY;
        if (panRangeY > 0) {
            const moveY = (deltaY / panRangeY) * 100;
            newY = activeDrag.initialObjPosY - moveY;
        }
        img.style.objectPosition = `${Math.max(0, Math.min(100, newX))}% ${Math.max(0, Math.min(100, newY))}%`;
    } else {
        const newLeft = activeDrag.initialLeft + deltaX;
        const newTop = activeDrag.initialTop + deltaY;
        activeDrag.element.style.left = `${newLeft}px`;
        activeDrag.element.style.top = `${newTop}px`;
    }
}

function onDragEnd(e) {
    if (!activeDrag.element) return;

    // Save the final position
    const slide = slides[activeSlideIndex];
    const container = activeDrag.element.closest('.image-container');
    const imgIndex = parseInt(container.dataset.imgIndex);

    if (!slide.positions) slide.positions = {};
    if (!slide.positions[imgIndex]) slide.positions[imgIndex] = {};

    if (activeDrag.isPanning) {
        slide.positions[imgIndex].objectPosition = activeDrag.element.style.objectPosition;
    } else {
        slide.positions[imgIndex].containerStyle = container.style.cssText;
        container.classList.remove('dragging');
    }
    
    activeDrag = { element: null, isPanning: false, startX: 0, startY: 0, initialLeft: 0, initialTop: 0, initialObjPosX: 50, initialObjPosY: 50 };
}


// ============== NEW COLLAGE & COLOR LOGIC (UPDATED) ==============

function generateCollageLayout(slide, slideIndex) {
    const images = slide.imagenes;
    const layoutStyle = slide.layoutStyle || 'overlap';
    const layoutClass = `layout-${layoutStyle}`;
    const countClass = `count-${images.length}`;

    const imageElements = images.map((file, imgIndex) => {
        const positionData = slide.positions?.[imgIndex] || {};
        const style = positionData.containerStyle ? positionData.containerStyle : getCollageStyle(slide.imagenes.length, imgIndex, layoutStyle);
        const objectPosition = positionData.objectPosition || '50% 50%';

        return `
        <div class="image-container" data-img-index="${imgIndex}" style="${style}">
            <img src="${URL.createObjectURL(file)}" alt="Imagen de ${slide.actividad}" style="object-position: ${objectPosition};">
            <button class="delete-image-btn" data-slide-index="${slideIndex}" data-img-index="${imgIndex}">
                <span class="icon" data-feather="x"></span>
            </button>
        </div>`
    }).join('');

    return `<div class="imagenes ${layoutClass} ${countClass}">${imageElements}</div>`;
}


function getCollageStyle(count, index, layoutStyle) {
    if (layoutStyle === 'grid') {
        // For grid layout, positioning is handled by CSS grid, so no inline styles are needed.
        return '';
    }
    
    // Fallback to overlap styles
    switch (count) {
        case 1:
            return 'width: 75%; height: 75%; top: 12%; left: 12.5%; border-radius: 16px; z-index: 5;';
        case 2:
            switch (index) {
                case 0: return 'width: 60%; height: 70%; top: 10%; left: 5%; transform: rotate(-6deg); z-index: 5;';
                case 1: return 'width: 60%; height: 70%; top: 20%; left: 35%; transform: rotate(4deg); z-index: 6;';
            }
        case 3:
            switch (index) {
                case 0: return 'width: 55%; height: 65%; top: 18%; left: 22.5%; z-index: 10;'; // Center
                case 1: return 'width: 45%; height: 50%; top: 5%; left: -2%; transform: rotate(-8deg); z-index: 9;'; // TL
                case 2: return 'width: 45%; height: 50%; top: 45%; left: 57%; transform: rotate(7deg); z-index: 9;'; // BR
            }
        case 4:
            switch (index) {
                case 0: return 'width: 48%; height: 48%; top: 2%; left: 2%; transform: rotate(-5deg); z-index: 5;';
                case 1: return 'width: 48%; height: 48%; top: 5%; left: 50%; transform: rotate(4deg); z-index: 6;';
                case 2: return 'width: 48%; height: 48%; top: 50%; left: 5%; transform: rotate(6deg); z-index: 7;';
                case 3: return 'width: 48%; height: 48%; top: 47%; left: 50%; transform: rotate(-4deg); z-index: 8;';
            }
        default:
             return `display: none;`;
    }
}


function rgbToHsl(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max == min) { h = s = 0; } 
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s == 0) { r = g = b = l; } 
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function generateColorPalette(hex) {
    const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
    let [h, s, l] = rgbToHsl(r, g, b);
    const [bg_r, bg_g, bg_b] = hslToRgb(h, s * 0.7, 0.96);
    const bg = `rgb(${bg_r},${bg_g},${bg_b})`;
    const [title_r, title_g, title_b] = hslToRgb(h, s, 0.2);
    const title = `rgb(${title_r},${title_g},${title_b})`;
    const [text_r, text_g, text_b] = hslToRgb(h, s, 0.3);
    const text = `rgb(${text_r},${text_g},${text_b})`;
    const accent1 = `rgb(${r},${g},${b})`;
    const [accent2_r, accent2_g, accent2_b] = hslToRgb(h, Math.min(1, s + 0.1), Math.max(0, l - 0.1));
    const accent2 = `rgb(${accent2_r},${accent2_g},${accent2_b})`;
    const commentBg = `rgba(255, 255, 255, 0.75)`;
    return { accent1, accent2, bg, title, text, commentBg };
}


// ============== NEW EXPORT LOGIC ==============

async function exportCurrentSlideAsImage() {
    const slideElement = document.querySelector('#main-slide-view .main-slide-content');
    if (!slideElement) {
        console.error("No se encontró el elemento de la diapositiva para exportar.");
        return null;
    }
    try {
        const slideStyle = window.getComputedStyle(slideElement);
        const slideBgColor = slideStyle.backgroundColor;
        const canvas = await html2canvas(slideElement, {
            useCORS: true, allowTaint: true, scale: 2,
            backgroundColor: slideBgColor, logging: false
        });
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch (error) {
        console.error("Error al renderizar la diapositiva con html2canvas:", error);
        return null;
    }
}

async function generarPPTX() {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const originalSlideIndex = activeSlideIndex;
    for (let i = 0; i < slides.length; i++) {
        displaySlide(i);
        await new Promise(resolve => setTimeout(resolve, 100));
        const slideImageData = await exportCurrentSlideAsImage();
        if (slideImageData) {
            const pSlide = pptx.addSlide();
            pSlide.addImage({ data: slideImageData, x: 0, y: 0, w: '100%', h: '100%' });
        }
    }
    displaySlide(originalSlideIndex);
    pptx.writeFile({ fileName: 'MiPresentacion_Assembler.pptx' });
}

async function generarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });
    const originalSlideIndex = activeSlideIndex;
    for (let i = 0; i < slides.length; i++) {
        displaySlide(i);
        await new Promise(resolve => setTimeout(resolve, 100));
        const slideImageData = await exportCurrentSlideAsImage();
        if (slideImageData) {
            if (i > 0) doc.addPage([1280, 720], 'landscape');
            doc.addImage(slideImageData, 'JPEG', 0, 0, 1280, 720);
        }
    }
    displaySlide(originalSlideIndex);
    doc.save('MiPresentacion_Assembler.pdf');
}
