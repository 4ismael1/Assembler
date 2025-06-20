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

// Initialize the theme on load
document.addEventListener('DOMContentLoaded', () => updateTheme(currentBaseColor));



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
    const base64ImageData = await fileToBase64(imageFile, false); // Get just the data
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
            const fotos = structure[grado][actividad].sort(() => 0.5 - Math.random()).slice(0, 5);
            if (fotos.length > 0) {
                slides.push({ 
                    grado, 
                    actividad, 
                    imagenes: fotos, 
                    aiComment: '', 
                    needsAi: true, 
                    isSelectedForAi: true,
                    geometry: generateGeometricShapes()
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
        const firstImage = URL.createObjectURL(slide.imagenes[0]);

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

    const slideContent = document.createElement('div');
    slideContent.className = 'main-slide-content';
    
    const shapesContainer = document.createElement('div');
    slide.geometry.forEach(shape => {
        const shapeEl = document.createElement('div');
        shapeEl.className = 'geo-shape';
        Object.assign(shapeEl.style, shape.style);
        shapesContainer.appendChild(shapeEl);
    });

    slideContent.innerHTML = `
        <h2 contenteditable="true" data-slide-index="${index}">${slide.actividad} – ${slide.grado}</h2>
        <div class="imagenes">
            ${slide.imagenes.map((file, imgIndex) => `
                <div class="image-container">
                    <img src="${URL.createObjectURL(file)}" alt="Imagen de ${slide.actividad}">
                    <button class="delete-image-btn" data-slide-index="${index}" data-img-index="${imgIndex}">
                        <span class="icon" data-feather="x"></span>
                    </button>
                </div>`).join('')}
        </div>
        <div class="ai-comment">${slide.aiComment}</div>
    `;
    slideContent.prepend(shapesContainer);
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

mainSlideView.addEventListener('click', e => {
    const deleteBtn = e.target.closest('.delete-image-btn');
    if(deleteBtn) {
        const slideIndex = parseInt(deleteBtn.dataset.slideIndex, 10);
        const imgIndex = parseInt(deleteBtn.dataset.imgIndex, 10);
        
        slides[slideIndex].imagenes.splice(imgIndex, 1);
        
        if (slides[slideIndex].imagenes.length === 0) {
            slides.splice(slideIndex, 1);
            activeSlideIndex = Math.max(0, slideIndex - 1);
            if (slides.length === 0) resetApp(); else renderPresentationView();
        } else {
            displaySlide(slideIndex);
            if (imgIndex === 0) renderPresentationView();
        }
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

buyCreditsBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) {
        alert("Debes iniciar sesión para añadir créditos.");
        return;
    }

    try {
        const userRef = db.collection('users').doc(user.uid);
        await userRef.update({
            credits: firebase.firestore.FieldValue.increment(10)
        });
        
        const creditToast = document.getElementById('credit-toast');
        creditToast.textContent = "+10 Créditos añadidos!";
        creditToast.classList.add('show');
        setTimeout(() => creditToast.classList.remove('show'), 3000);
    } catch (error) {
        console.error("Error adding credits:", error);
        alert("Hubo un problema al añadir los créditos.");
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
function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.width, height: img.height });
            URL.revokeObjectURL(img.src); // Clean up memory
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

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
    const shapeCount = Math.floor(Math.random() * 5) + 5; // 5 to 9 shapes

    for (let i = 0; i < shapeCount; i++) {
        const size = (Math.random() * 25 + 10) + '%'; // 10% to 35% size
        shapes.push({
            style: {
                width: size,
                height: size,
                top: (Math.random() * 90 - 10) + '%', // -10% to 80%
                left: (Math.random() * 90 - 10) + '%', // -10% to 80%
                transform: `rotate(${Math.random() * 360}deg)`,
                borderRadius: `${Math.random() * 50}%`,
                opacity: (Math.random() * 0.3 + 0.1).toFixed(2), // 0.1 to 0.4 opacity
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

    // Re-render current slide to apply new colors immediately
    if (slides.length > 0) {
        displaySlide(activeSlideIndex);
    }
}

function generateColorPalette(hex) {
    const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
    const toRgb = (r,g,b,a=1) => `rgba(${r},${g},${b},${a})`;

    // Simple algorithm to generate a palette
    const accent1 = `rgb(${r},${g},${b})`;
    const accent2 = toRgb(Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40));
    const bg = toRgb(Math.min(255, r + 120), Math.min(255, g + 120), Math.min(255, b + 120), 0.2);
    const title = toRgb(Math.max(0, r - 80), Math.max(0, g - 80), Math.max(0, b - 80));
    const text = toRgb(Math.max(0, r - 40), Math.max(0, g - 40), Math.max(0, b - 40));
    const commentBg = toRgb(255, 255, 255, 0.7);

    return {
        accent1, accent2, bg, title, text, commentBg,
        // For export functions
        titleHex: title.replace('rgb(', '#').replace(')', '').split(',').map(c => parseInt(c).toString(16).padStart(2, '0')).join(''),
        textHex: text.replace('rgb(', '#').replace(')', '').split(',').map(c => parseInt(c).toString(16).padStart(2, '0')).join(''),
        commentBgHex: 'FFFFFF'
    };
}

async function createSlideBackground(slide) {
    const tempDiv = document.createElement('div');
    tempDiv.style.width = '1280px';
    tempDiv.style.height = '720px';
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px'; 
    tempDiv.className = 'main-slide-content';

    // Apply current theme colors directly for rendering
    const palette = generateColorPalette(currentBaseColor);
    tempDiv.style.backgroundColor = palette.bg;

    const shapesContainer = document.createElement('div');
    slide.geometry.forEach(shape => {
        const shapeEl = document.createElement('div');
        shapeEl.className = 'geo-shape';
        Object.assign(shapeEl.style, shape.style);
        // Replace CSS variables with actual colors for canvas rendering
        if (shapeEl.style.backgroundColor.includes('accent1')) {
            shapeEl.style.backgroundColor = palette.accent1;
        } else {
            shapeEl.style.backgroundColor = palette.accent2;
        }
        shapesContainer.appendChild(shapeEl);
    });
    tempDiv.appendChild(shapesContainer);

    document.body.appendChild(tempDiv);
    
    const canvas = await html2canvas(tempDiv, {
        useCORS: true,
        backgroundColor: null
    });
    const dataUrl = canvas.toDataURL('image/png');
    document.body.removeChild(tempDiv);
    return dataUrl;
}

async function generarPPTX() {
    const pptx = new PptxGenJS();
    
    const colors = generateColorPalette(currentBaseColor);
    const SLIDE_W = 10, SLIDE_H = 5.625, MARGIN = 0.4, TITLE_H = 0.8;
    const COMMENT_AREA_H = 0.7, CONTENT_H = SLIDE_H - TITLE_H - MARGIN - COMMENT_AREA_H;
    const CONTENT_W = SLIDE_W - MARGIN * 2, CONTENT_Y_START = TITLE_H, GAP = 0.15;

    for (const slide of slides) {
        if (slide.imagenes.length === 0) continue;
        const pSlide = pptx.addSlide();

        const backgroundImage = await createSlideBackground(slide);
        pSlide.background = { data: backgroundImage };
        
        pSlide.addText(`${slide.actividad} – ${slide.grado}`, { 
            x: MARGIN, y: 0.2, w: CONTENT_W, h: TITLE_H - 0.2, 
            fontFace: 'Inter', fontSize: 24, color: colors.titleHex.substring(1), 
            align: 'center', valign: 'middle',
            fill: { color: 'FFFFFF', transparency: 20 } 
        });

        if (slide.aiComment) {
            pSlide.addText(slide.aiComment, { 
                x: MARGIN, y: SLIDE_H - MARGIN - (COMMENT_AREA_H - 0.1), w: CONTENT_W, h: COMMENT_AREA_H - 0.1, 
                fontFace: 'Inter', fontSize: 11, color: colors.textHex.substring(1), 
                align: 'left', italic: true, valign: 'top',
                fill: { color: colors.commentBgHex, transparency: 15 }
            });
        }

        const images = slide.imagenes;
        let layouts = [];
        switch (images.length) {
            case 1: layouts.push({ x: MARGIN, y: CONTENT_Y_START, w: CONTENT_W, h: CONTENT_H }); break;
            case 2: const w2 = (CONTENT_W - GAP) / 2; layouts.push({ x: MARGIN, y: CONTENT_Y_START, w: w2, h: CONTENT_H }); layouts.push({ x: MARGIN + w2 + GAP, y: CONTENT_Y_START, w: w2, h: CONTENT_H }); break;
            case 3: const w3_main = CONTENT_W * 0.65 - GAP / 2; const w3_side = CONTENT_W * 0.35 - GAP / 2; const h3_side = (CONTENT_H - GAP) / 2; layouts.push({ x: MARGIN, y: CONTENT_Y_START, w: w3_main, h: CONTENT_H }); layouts.push({ x: MARGIN + w3_main + GAP, y: CONTENT_Y_START, w: w3_side, h: h3_side }); layouts.push({ x: MARGIN + w3_main + GAP, y: CONTENT_Y_START + h3_side + GAP, w: w3_side, h: h3_side }); break;
            case 4: const w4 = (CONTENT_W - GAP) / 2; const h4 = (CONTENT_H - GAP) / 2; layouts.push({ x: MARGIN, y: CONTENT_Y_START, w: w4, h: h4 }); layouts.push({ x: MARGIN + w4 + GAP, y: CONTENT_Y_START, w: w4, h: h4 }); layouts.push({ x: MARGIN, y: CONTENT_Y_START + h4 + GAP, w: w4, h: h4 }); layouts.push({ x: MARGIN + w4 + GAP, y: CONTENT_Y_START + h4 + GAP, w: w4, h: h4 }); break;
            default: const h5 = (CONTENT_H - GAP) / 2; const w5_top = (CONTENT_W - GAP) / 2; layouts.push({ x: MARGIN, y: CONTENT_Y_START, w: w5_top, h: h5 }); layouts.push({ x: MARGIN + w5_top + GAP, y: CONTENT_Y_START, w: w5_top, h: h5 }); const y5_bottom = CONTENT_Y_START + h5 + GAP; const w5_bottom = (CONTENT_W - GAP * 2) / 3; layouts.push({ x: MARGIN, y: y5_bottom, w: w5_bottom, h: h5 }); layouts.push({ x: MARGIN + w5_bottom + GAP, y: y5_bottom, w: w5_bottom, h: h5 }); layouts.push({ x: MARGIN + (w5_bottom + GAP) * 2, y: y5_bottom, w: w5_bottom, h: h5 }); break;
        }
        for (let i = 0; i < images.length; i++) {
            if (!layouts[i]) continue;
            const base64 = await fileToBase64(images[i]); 
            pSlide.addImage({ data: base64, ...layouts[i], sizing: { type: 'contain', w: layouts[i].w, h: layouts[i].h, x: 0.5, y: 0.5 } });
        }
    }
    pptx.writeFile({ fileName: 'MiPresentacion.pptx' });
}


async function generarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [1280, 720]
    });

    const colors = generateColorPalette(currentBaseColor);
    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        if (i > 0) doc.addPage([1280, 720], 'landscape');
        
        const backgroundImage = await createSlideBackground(slide);
        doc.addImage(backgroundImage, 'PNG', 0, 0, 1280, 720);

        doc.setFont('Inter', 'bold');
        doc.setFontSize(48);
        doc.setTextColor(colors.titleHex);
        doc.text(`${slide.actividad} – ${slide.grado}`, 1280 / 2, 80, { align: 'center' });

        if (slide.aiComment) {
            doc.setFont('Inter', 'italic'); doc.setFontSize(22);
            doc.setTextColor(colors.textHex);
            const splitComment = doc.splitTextToSize(slide.aiComment, 1280 - 100);
            doc.text(splitComment, 50, 620);
        }
        
        const images = slide.imagenes;
        let layouts = [];
        const CONTENT_W = 1280 - 100, CONTENT_H = 720 - 250, CONTENT_Y_START = 120, GAP = 20;

        switch (images.length) {
             case 1: layouts.push({ x: 50, y: CONTENT_Y_START, w: CONTENT_W, h: CONTENT_H }); break;
            case 2: const w2 = (CONTENT_W - GAP) / 2; layouts.push({ x: 50, y: CONTENT_Y_START, w: w2, h: CONTENT_H }); layouts.push({ x: 50 + w2 + GAP, y: CONTENT_Y_START, w: w2, h: CONTENT_H }); break;
            case 3: const w3_main = CONTENT_W * 0.65 - GAP / 2; const w3_side = CONTENT_W * 0.35 - GAP / 2; const h3_side = (CONTENT_H - GAP) / 2; layouts.push({ x: 50, y: CONTENT_Y_START, w: w3_main, h: CONTENT_H }); layouts.push({ x: 50 + w3_main + GAP, y: CONTENT_Y_START, w: w3_side, h: h3_side }); layouts.push({ x: 50 + w3_main + GAP, y: CONTENT_Y_START + h3_side + GAP, w: w3_side, h: h3_side }); break;
            case 4: const w4 = (CONTENT_W - GAP) / 2; const h4 = (CONTENT_H - GAP) / 2; layouts.push({ x: 50, y: CONTENT_Y_START, w: w4, h: h4 }); layouts.push({ x: 50 + w4 + GAP, y: CONTENT_Y_START, w: w4, h: h4 }); layouts.push({ x: 50, y: CONTENT_Y_START + h4 + GAP, w: w4, h: h4 }); layouts.push({ x: 50 + w4 + GAP, y: CONTENT_Y_START + h4 + GAP, w: w4, h: h4 }); break;
            default: const h5 = (CONTENT_H - GAP) / 2; const w5_top = (CONTENT_W - GAP) / 2; layouts.push({ x: 50, y: CONTENT_Y_START, w: w5_top, h: h5 }); layouts.push({ x: 50 + w5_top + GAP, y: CONTENT_Y_START, w: w5_top, h: h5 }); const y5_bottom = CONTENT_Y_START + h5 + GAP; const w5_bottom = (CONTENT_W - GAP * 2) / 3; layouts.push({ x: 50, y: y5_bottom, w: w5_bottom, h: h5 }); layouts.push({ x: 50 + w5_bottom + GAP, y: y5_bottom, w: w5_bottom, h: h5 }); layouts.push({ x: 50 + (w5_bottom + GAP) * 2, y: y5_bottom, w: w5_bottom, h: h5 }); break;
        }

        for(let j = 0; j < images.length; j++) {
            if (!layouts[j]) continue;
            
            const layoutBox = layouts[j];
            const imageFile = images[j];

            const { width: imgWidth, height: imgHeight } = await getImageDimensions(imageFile);
            const imgAspectRatio = imgWidth / imgHeight;
            const boxAspectRatio = layoutBox.w / layoutBox.h;

            let newWidth, newHeight;

            if (imgAspectRatio > boxAspectRatio) {
                newWidth = layoutBox.w;
                newHeight = layoutBox.w / imgAspectRatio;
            } else {
                newHeight = layoutBox.h;
                newWidth = layoutBox.h * imgAspectRatio;
            }

            const newX = layoutBox.x + (layoutBox.w - newWidth) / 2;
            const newY = layoutBox.y + (layoutBox.h - newHeight) / 2;

            const imgData = await fileToBase64(imageFile);
            doc.addImage(imgData, 'JPEG', newX, newY, newWidth, newHeight);
        }
    }

    doc.save('MiPresentacion.pdf');
}
