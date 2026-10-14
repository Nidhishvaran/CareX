# MediGuard AI local demo

Responsive full-stack MediGuard AI demo. The frontend is plain HTML, CSS, and JavaScript. The local API uses Node.js built-in modules and stores demo profiles in `data/mediguard.json`; uploaded files go to `data/uploads/`.

## Run locally (One Command in VS Code)

You can launch the full project in **one command** using any of these methods:

1. **Integrated Terminal Command:**
   ```sh
   npm run dev
   ```
   *(Or simply run `.\run.bat` on Windows)*

2. **VS Code Keyboard Shortcut:**
   - Press **`Ctrl + Shift + B`** (or `Cmd + Shift + B` on Mac) to run the pre-configured VS Code default build task.

3. **VS Code Run & Debug (F5):**
   - Press **`F5`** to launch with the integrated debugger attached.

---

### Manual / Step-by-Step Run
Requires Node.js 18 or newer and Python 3.10 or newer. Install the Python dependencies:

```sh
python -m pip install -r requirements.txt
```

```sh
node scripts/serve.mjs
```

The server reads the prebuilt graph from `data/knowledge-graph.json` and patient QR PNG files from `data/qr/`; it does not launch Python at runtime. Regenerate the graph after editing the CSV with:

```powershell
python scripts/build_graph_data.py --output data/knowledge-graph.json
python scripts/create_qr.py DEMO-PT-4092 data/qr/DEMO-PT-4092.png
python scripts/create_qr.py DEMO-PT-3810 data/qr/DEMO-PT-3810.png
```

Open `http://localhost:4173`. Demo sign-in code: `123456`.
You can also click **⚡ Instant Demo Sign In** on the login page for 1-click access without entering a code.

- Doctor: `doctor@mediguard.demo`
- Patient 1: `patient@mediguard.demo` (Eleanor Vance)
- Patient 2: `patient2@mediguard.demo` (Marcus Henderson)

All names, profiles, IDs, and patient-reported allergies are fictional demo records.

Build the static frontend with `node scripts/build.mjs`. After building, use `node scripts/serve.mjs --dist` to serve the built frontend together with the API.

## Backend Features

- Local demo code requests and sessions, patient registration, and logout.
- Patient lookup and profile editing; doctor profile editing.
- Persistent assessment history and review-status updates.
- Local document storage for PDF, PNG, and JPEG files (10 MB limit and content signature checks).
- Audit entries for profile, assessment, upload, and review actions.
- Two seeded patient profiles with separately displayed fictional allergy entries.
- Patient ID QR pass; doctor camera QR scanner when the browser supports `BarcodeDetector`, plus manual ID lookup fallback.
- `data/medicines.csv` has 34 brand-alias and generic-name examples. The alias is not product-verified; check exact package and country-specific labeling.
- A Python graph builder uses NetworkX for spring layout, connectivity, density, and degree analytics when installed. Without NetworkX, it reports a clearly named Python fallback and keeps the graph view available. The checked-in prebuilt graph currently uses the fallback because this environment could not reach the package index to install NetworkX.
- Selected side-effect terms are excerpts from the linked DailyMed product labels. Other catalog entries link to a DailyMed search and do not claim side-effect data is locally curated.

- Real-time PDF prescription parser supporting PDF 1.4, PDFium, Chrome, Adobe ASCII85, and compressed stream formats (`contraindication_engine.mjs`).
- Automatic drug name, strength/dosage, directions, patient metadata, and diagnosis extraction from tabular clinic/hospital prescriptions.
- Clinical contraindication engine detecting critical combinations that cannot be paired (e.g. Dual RAAS Blockade: Lisinopril + Losartan; Bleeding: Warfarin + Aspirin; Serotonin Syndrome: Sertraline + Tramadol) and guideline-recommended synergies (Amlodipine + Hydrochlorothiazide).
- Dynamic recreated SVG knowledge graph with force layout, interactive zooming, panning, and dual Patient / Doctor perspective views.

## Clinical and deployment limits

The demo code is fixed (`123456` or 1-click Instant Sign-in), sessions are held in process memory, and there is no real identity provider or message delivery. Uploaded prescription PDFs are parsed locally with our dedicated pharmacotherapy engine and validated against evidence-based rules. Brand aliases and interaction rules are clinical demonstration models.

This local demo is designed for clinical workflow evaluation and testing, not for real unsupervised patient care. Before clinical production deployment, integrate hospital EHR interfaces, FHIR interoperability, certified drug knowledge bases (e.g. First Databank / Lexicomp), and medical device compliance.
