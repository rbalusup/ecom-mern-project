TODO
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      {
        find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/,
        replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
      }
    ]
  },
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'pdf': ['react-pdf', 'pdfjs-dist'],
          'icons': ['lucide-react']
        }
      }
    },
    chunkSizeWarningLimit: 600,
    minify: 'esbuild'
  }
})

================================================================================

{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}

================================================================================

{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}

=========================================================================================

# Digital Twin React Application

Healthcare data visualization and claims document management frontend for virtual assistant API.

## Features

- **Data Visualization** - Benefits, claims, providers with A2UI protocol support
- **Document Upload** - Drag-and-drop images/PDFs with preview (max 10MB)
- **Responsive Design** - Mobile-friendly with TailwindCSS 

## Tech Stack

- React 19 + TypeScript 5.8
- Vite 4 + React Router v7
- TailwindCSS 3 + Lucide Icons
- React PDF for document preview

## Getting Started

### Prerequisites

- Node.js 22.11.0+ (see `.nvmrc`)
- pnpm 10.29.3+
- Backend API running on `http://localhost:9020`

### Quick Start

```bash
# Install dependencies
pnpm install

# Start dev server (http://localhost:3000)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

### Routes

- `/` - Data visualization (requires `message_id` query param)
- `/upload` - Document upload

## Usage Examples

```bash
# Data visualization with message_id
http://localhost:3000/?message_id=d676bbc2-b712-48b2-9350-7a25f9751af0

# Document upload
http://localhost:3000/upload
```

## API Endpoints

### Environments

The environment is detected automatically at runtime from the browser hostname — no build-time configuration required. A single build serves all environments.

| Hostname                       | Environment | Backend                 |
| ------------------------------ | ----------- | ----------------------- |
| `localhost` / `127.0.0.1`      | local       | `http://localhost:8000` |
| `*alb-dev*`                    | dev         | `va-dev...`             |
| `*alb-sit*`                    | sit         | `va-sit...`             |
| `dtwin-uat.elegancehealth.com` | uat         | `va-uat...`             |
| `dtwin.elegancehealth.com`     | prod        | `va-prod...`            |

### Endpoints

- **GET** `/data?message_id={id}` - Fetch healthcare data
- **POST** `/document/upload` - Upload document (multipart/form-data)

## Project Structure

```
src/
├── components/         # React components (renderers, upload, UI states)
├── pages/              # DataViewPage, UploadPage
├── types/              # TypeScript definitions
├── config/             # Environment configuration
└── App.tsx             # Main app with routing
```

## Troubleshooting

```bash
# Dependency issues
rm -rf node_modules pnpm-lock.yaml && pnpm install

# Port conflict
pnpm dev --port 3001

# Linting/formatting
pnpm lint:fix && pnpm format
```

## Contributing

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Before committing
pnpm lint:fix && pnpm format && pnpm build

# Commit with conventional commits
git commit -m "feat: add new feature"
```

## License

MIT

==================================================================================

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

=================================================================================

{
  "name": "a2ui-viewer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.11.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext .js,.jsx,.ts,.tsx",
    "lint:fix": "eslint . --ext .js,.jsx,.ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{js,jsx,ts,tsx,json,css,md}\"",
    "format:check": "prettier --check \"src/**/*.{js,jsx,ts,tsx,json,css,md}\""
  },
  "dependencies": {
    "jspdf": "^4.2.1",
    "lucide-react": "^0.468.0",
    "pdfjs-dist": "^6.3.289",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-pdf": "^11.0.0",
    "react-router-dom": "^7.18.3"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@typescript-eslint/eslint-plugin": "^7.9.0",
    "@typescript-eslint/parser": "^7.9.0",
    "@vitejs/plugin-react": "^4.0.3",
    "autoprefixer": "^10.4.14",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^8.3.0",
    "eslint-plugin-import": "^2.27.5",
    "eslint-plugin-prettier": "^5.0.0",
    "eslint-plugin-react": "^7.32.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-simple-import-sort": "^10.0.0",
    "postcss": "^8.5.28",
    "prettier": "^3.0.3",
    "tailwindcss": "^3.3.3",
    "typescript": "5.8.3",
    "vite": "^6.4.3"
  },
  "packageManager": "pnpm@10.29.3",
  "pnpm": {
    "overrides": {
      "browserslist": "^4.28.9",
      "nanoid": "^3.3.17"
    }
  }
}

============================================================================

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>anhem</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

==================================================================================

import { Route, Routes } from 'react-router-dom';

import { ChatbotPage } from './pages/ChatbotPage';
import { DataViewPage } from './pages/DataViewPage';
import { InternalTestChatbotPage } from './pages/InternalTestChatbotPage';
import { UploadPage } from './pages/UploadPage';

function App() {
  return (
    <Routes>
      <Route path="/chatbot" element={<ChatbotPage />} />
      <Route path="/orchestrate-tester" element={<InternalTestChatbotPage />} />
      <Route path="/upload" element={<UploadPage />} />
      <Route path="/" element={<DataViewPage />} />
      <Route path="*" element={<DataViewPage />} />
    </Routes>
  );
}

export default App;

=============================================================================

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(0, 0, 0, 0.87);
  background-color: #ffffff;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  width: 100%;
  margin: 0 auto;
}

=====================================================================

import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);


================================================================================

/// <reference types="vite/client" />

=================================================================================

export const en = {
  // Generic fallbacks
  noDataAvailable: 'No data available',
  noInformationAvailable: 'No information available',

  // BenefitsRenderer
  noBenefitInfo: 'No benefit information available',
  myBenefits: 'My Benefits',
  medicalPlanSummary: 'Medical Plan Summary',
  inNetwork: 'In Network',
  outOfNetwork: 'Out of Network',
  deductible: 'Deductible',
  outOfPocketMax: 'Out-of-Pocket Max',
  individual: 'Individual',
  family: 'Family',
  met: 'Met',
  spent: 'Spent',
  remaining: 'Remaining',
  benefitsSummaryNote: 'This is a summary of your benefits. For complete details, please refer to your plan documents.',

  // PriorAuthListRenderer
  noPriorAuthInfo: 'No prior authorization information available',
  priorAuthorizations: 'Prior Authorizations',
  foundAuthorization: 'Authorization',
  foundAuthorizations: 'Authorizations',
  found: 'Found',
  showing: 'Showing',
  of: 'of',
  noPriorAuthsFound: 'No prior authorizations found',
  highlighted: 'Highlighted',
  processedOn: 'Processed on',
  serviceRequested: 'Service Requested',
  requestedBy: 'Requested By',
  lastUpdated: 'Last Updated',
  statusReason: 'Status Reason',
  youHave: 'You have',
  moreAuthorization: 'authorization',
  moreAuthorizations: 'authorizations',
  replyAll: 'Reply',
  toViewCompleteList: 'to view the complete list.',

  // ClaimsSearchListRenderer
  noClaimsInfo: 'No claims information available',
  claimsSearchResults: 'Claims Search Results',
  foundClaim: 'Claim',
  foundClaims: 'Claims',
  noClaimsFound: 'No claims found',
  claimEnding: 'Claim ending',
  serviceOn: 'Service on',
  receivedDate: 'Received Date',
  totalCharge: 'Total Charge',
  youPay: 'You Pay',
  provider: 'Provider',
  type: 'Type',
  moreClaim: 'claim',
  moreClaims: 'claims',
  notAvailable: 'Not Available',

  // ClaimsSummaryRenderer
  myClaims: 'My Claims',
  viewAndTrackClaims: 'View and track your healthcare claims',
  totalCharged: 'Total Charged',
  claimsSummary: 'Claims Summary',
  noClaimsMatchingFilters: 'No claims found matching your filters',
  providerName: 'Provider Name: ',
  claimNumber: 'Claim #',
  serviceDate: 'Service Date',
  claimType: 'Claim Type',
  claimsNote: 'Claims are updated regularly. For questions about a specific claim, please contact customer service.',

  // ClaimDetailRenderer
  noClaimDetailsAvailable: 'No claim details available',
  claimDetails: 'Claim Details',
  backToClaims: 'Back to Claims',
  claimSummary: 'Claim Summary',
  medicalClaim: 'Medical Claim',
  claimInformation: 'Claim Information',
  query: 'Query',
  status: 'Status',
  billedBy: 'Billed by',
  serviceDateLabel: 'Service Date',
  claimNumberLabel: 'Claim Number',
  claimTypeLabel: 'Claim Type',
  processedDate: 'Processed Date',
  networkStatus: 'Network Status',
  providerInformation: 'Provider Information',
  providerNameLabel: 'Provider Name',
  providerTypeLabel: 'Provider Type',
  serviceDescription: 'Service Description',
  patientInformation: 'Patient Information',
  patientName: 'Patient Name',
  dateOfBirth: 'Date of Birth',
  subscriberName: 'Subscriber Name',
  groupNumber: 'Group Number',
  overview: 'Overview',
  breakdown: 'Breakdown',
  payment: 'Payment',
  whatYouPayInNetwork: 'What you pay (in-network)',
  relatedQuestions: 'Related Questions',
  costBreakdown: 'Cost Breakdown',
  totalAllowed: 'Total Allowed',
  appliedToAnnualDeductible: 'Applied to your annual deductible',
  coinsurance: 'Coinsurance',
  yourShareAfterDeductible: 'Your share after deductible',
  copay: 'Copay',
  fixedAmountForService: 'Fixed amount for service',
  planPaid: 'Plan Paid',
  yourResponsibility: 'Your Responsibility',
  serviceLineItems: 'Service Line Items',
  line: 'Line',
  code: 'Code',
  units: 'Units',
  charged: 'Charged',
  allowed: 'Allowed',
  youOwe: 'You Owe',
  diagnosisCodes: 'Diagnosis Codes',
  remarks: 'Remarks',
  paymentHistory: 'Payment History',
  checkNumber: 'Check #',
  noPaymentInfo: 'No payment information available',
  appealRights: 'Appeal Rights',

  // ClaimsBecaDirectCallRenderer
  noClaimInfo: 'No claim information available',

  // FindCareRenderer
  noProviderInfo: 'No provider information available',
  totalProviders: 'Total Providers',
  inNetworkLabel: 'In-Network',
  distanceRange: 'Distance Range',
  noProvidersFound: 'No Providers Found',
  tryAdjustingSearch: 'Try adjusting your search criteria or location.',
  away: 'away',
  reviews: 'reviews',
  providerNote: 'Provider information is updated regularly. Please verify details before scheduling an appointment.',

  // PharmacyOrdersRenderer
  noPharmacyInfo: 'No pharmacy order information available',
  pharmacyOrders: 'Pharmacy Orders',
  foundOrder: 'Order',
  foundOrders: 'Orders',
  noOrdersFound: 'No pharmacy orders found',
  moreOrder: 'order',
  moreOrders: 'orders',
  orderEnding: 'Order ending',
  orderedOn: 'Ordered on',
  medication: 'Medication',
  member: 'Member',
  previous: 'Previous',
  next: 'Next',
  page: 'Page',

  // PharmacyOrderDetailRenderer
  noOrderDetailsAvailable: 'No order details available',
  prescription: 'Prescription',
  prescriber: 'Prescriber',
  totalCost: 'Total Cost',
  salesTax: 'Sales Tax',
  shipping: 'Shipping',
  free: 'Free',
  totalPrice: 'Total Price',
  amountPlanPaid: 'Amount Plan Paid',
  remainingBalance: 'Remaining Balance',
  dob: 'DOB',

  // LinkExpiredDisplay
  linkExpiredTitle: 'Link Expired',
  linkExpiredMessage:
    'This secure link is no longer valid. Please return to your conversation and request the information again to receive a new link.',

  // IdCardRenderer
  noIdCardInfo: 'No ID card information available',
  idCards: 'ID Cards',

  // PlanInfoRenderer
  planInformation: 'Plan Information',
  noPlanInfo: 'No plan information available',
  downloadPdf: 'Download PDF',
  front: 'Front',
  back: 'Back',
  cardImageNotAvailable: 'Card image not available',
  memberIdCard: 'Member ID Card',
} as const;

==============================================================================================

export const es = {
  // Generic fallbacks
  noDataAvailable: 'No hay datos disponibles',
  noInformationAvailable: 'No hay información disponible',

  // BenefitsRenderer
  noBenefitInfo: 'No hay información de beneficios disponible',
  myBenefits: 'Mis Beneficios',
  medicalPlanSummary: 'Resumen del Plan Médico',
  inNetwork: 'En la Red',
  outOfNetwork: 'Fuera de la Red',
  deductible: 'Deducible',
  outOfPocketMax: 'Máximo de Gastos de Bolsillo',
  individual: 'Individual',
  family: 'Familia',
  met: 'Alcanzado',
  spent: 'Gastado',
  remaining: 'Restante',
  benefitsSummaryNote:
    'Este es un resumen de sus beneficios. Para obtener detalles completos, consulte los documentos de su plan.',

  // PriorAuthListRenderer
  noPriorAuthInfo: 'No hay información de autorización previa disponible',
  priorAuthorizations: 'Autorizaciones Previas',
  foundAuthorization: 'Autorización',
  foundAuthorizations: 'Autorizaciones',
  found: 'Se encontraron',
  showing: 'Mostrando',
  of: 'de',
  noPriorAuthsFound: 'No se encontraron autorizaciones previas',
  highlighted: 'Destacado',
  processedOn: 'Procesado el',
  serviceRequested: 'Servicio Solicitado',
  requestedBy: 'Solicitado Por',
  lastUpdated: 'Última Actualización',
  statusReason: 'Motivo del Estado',
  youHave: 'Tiene',
  moreAuthorization: 'autorización',
  moreAuthorizations: 'autorizaciones',
  replyAll: 'Responda',
  toViewCompleteList: 'para ver la lista completa.',

  // ClaimsSearchListRenderer
  noClaimsInfo: 'No hay información de reclamaciones disponible',
  claimsSearchResults: 'Resultados de Búsqueda de Reclamaciones',
  foundClaim: 'Reclamación',
  foundClaims: 'Reclamaciones',
  noClaimsFound: 'No se encontraron reclamaciones',
  claimEnding: 'Reclamación que termina en',
  serviceOn: 'Servicio el',
  receivedDate: 'Fecha de Recepción',
  totalCharge: 'Cargo Total',
  youPay: 'Usted Paga',
  provider: 'Proveedor',
  type: 'Tipo',
  moreClaim: 'reclamación',
  moreClaims: 'reclamaciones',
  notAvailable: 'No Disponible',

  // ClaimsSummaryRenderer
  myClaims: 'Mis Reclamaciones',
  viewAndTrackClaims: 'Ver y rastrear sus reclamaciones médicas',
  totalCharged: 'Total Cobrado',
  claimsSummary: 'Resumen de Reclamaciones',
  noClaimsMatchingFilters: 'No se encontraron reclamaciones que coincidan con sus filtros',
  providerName: 'Nombre del Proveedor: ',
  claimNumber: 'Reclamación #',
  serviceDate: 'Fecha de Servicio',
  claimType: 'Tipo de Reclamación',
  claimsNote:
    'Las reclamaciones se actualizan regularmente. Para preguntas sobre una reclamación específica, comuníquese con el servicio al cliente.',

  // ClaimDetailRenderer
  noClaimDetailsAvailable: 'No hay detalles de reclamación disponibles',
  claimDetails: 'Detalles de la Reclamación',
  backToClaims: 'Volver a Reclamaciones',
  claimSummary: 'Resumen de la Reclamación',
  medicalClaim: 'Reclamación Médica',
  claimInformation: 'Información de la Reclamación',
  query: 'Consulta',
  status: 'Estado',
  billedBy: 'Facturado por',
  serviceDateLabel: 'Fecha de Servicio',
  claimNumberLabel: 'Número de Reclamación',
  claimTypeLabel: 'Tipo de Reclamación',
  processedDate: 'Fecha de Procesamiento',
  networkStatus: 'Estado de la Red',
  providerInformation: 'Información del Proveedor',
  providerNameLabel: 'Nombre del Proveedor',
  providerTypeLabel: 'Tipo de Proveedor',
  serviceDescription: 'Descripción del Servicio',
  patientInformation: 'Información del Paciente',
  patientName: 'Nombre del Paciente',
  dateOfBirth: 'Fecha de Nacimiento',
  subscriberName: 'Nombre del Suscriptor',
  groupNumber: 'Número de Grupo',
  overview: 'Resumen',
  breakdown: 'Desglose',
  payment: 'Pago',
  whatYouPayInNetwork: 'Lo que usted paga (en la red)',
  relatedQuestions: 'Preguntas Relacionadas',
  costBreakdown: 'Desglose de Costos',
  totalAllowed: 'Total Permitido',
  appliedToAnnualDeductible: 'Aplicado a su deducible anual',
  coinsurance: 'Coseguro',
  yourShareAfterDeductible: 'Su parte después del deducible',
  copay: 'Copago',
  fixedAmountForService: 'Cantidad fija por servicio',
  planPaid: 'Pagado por el Plan',
  yourResponsibility: 'Su Responsabilidad',
  serviceLineItems: 'Artículos de Línea de Servicio',
  line: 'Línea',
  code: 'Código',
  units: 'Unidades',
  charged: 'Cargado',
  allowed: 'Permitido',
  youOwe: 'Usted Debe',
  diagnosisCodes: 'Códigos de Diagnóstico',
  remarks: 'Comentarios',
  paymentHistory: 'Historial de Pagos',
  checkNumber: 'Cheque #',
  noPaymentInfo: 'No hay información de pago disponible',
  appealRights: 'Derechos de Apelación',

  // ClaimsBecaDirectCallRenderer
  noClaimInfo: 'No hay información de reclamación disponible',

  // FindCareRenderer
  noProviderInfo: 'No hay información de proveedores disponible',
  totalProviders: 'Total de Proveedores',
  inNetworkLabel: 'En la Red',
  distanceRange: 'Rango de Distancia',
  noProvidersFound: 'No se encontraron proveedores',
  tryAdjustingSearch: 'Intente ajustar sus criterios de búsqueda o ubicación.',
  away: 'de distancia',
  reviews: 'reseñas',
  providerNote:
    'La información de proveedores se actualiza regularmente. Verifique los detalles antes de programar una cita.',

  // PharmacyOrdersRenderer
  noPharmacyInfo: 'No hay información de pedidos de farmacia disponible',
  pharmacyOrders: 'Pedidos de Farmacia',
  foundOrder: 'Pedido',
  foundOrders: 'Pedidos',
  noOrdersFound: 'No se encontraron pedidos de farmacia',
  moreOrder: 'pedido',
  moreOrders: 'pedidos',
  orderEnding: 'Pedido que termina en',
  orderedOn: 'Pedido el',
  medication: 'Medicamento',
  member: 'Miembro',
  previous: 'Anterior',
  next: 'Siguiente',
  page: 'Página',

  // PharmacyOrderDetailRenderer
  noOrderDetailsAvailable: 'No hay detalles del pedido disponibles',
  prescription: 'Receta',
  prescriber: 'Prescriptor',
  totalCost: 'Costo Total',
  salesTax: 'Impuesto sobre Ventas',
  shipping: 'Envío',
  free: 'Gratis',
  totalPrice: 'Precio Total',
  amountPlanPaid: 'Monto Pagado por el Plan',
  remainingBalance: 'Saldo Restante',
  dob: 'Fecha de Nacimiento',

  // LinkExpiredDisplay
  linkExpiredTitle: 'Enlace Expirado',
  linkExpiredMessage:
    'Este enlace seguro ya no es válido. Por favor, regrese a su conversación y solicite la información nuevamente para recibir un nuevo enlace.',

  // IdCardRenderer
  noIdCardInfo: 'No hay información de tarjeta de identificación disponible',
  idCards: 'Tarjetas de Identificación',

  // PlanInfoRenderer
  planInformation: 'Información del plan',
  noPlanInfo: 'No hay información del plan disponible',
  downloadPdf: 'Descargar PDF',
  front: 'Frente',
  back: 'Reverso',
  cardImageNotAvailable: 'Imagen de la tarjeta no disponible',
  memberIdCard: 'Tarjeta de Identificación del Miembro',
} as const;


=======================================================================================================

import { en } from './locales/en';
import { es } from './locales/es';

export type Language = 'en' | 'es';

type Translations = { [K in keyof typeof en]: string };

const locales: { en: Translations; es: Translations } = { en, es };

export function getTranslations(language?: string): Translations {
  const lang = language === 'es' ? 'es' : 'en';
  return locales[lang];
}

=================================================================================

export const parseLocalDate = (dateString: string): Date | null => {
  if (!dateString) {
    return null;
  }

  const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  const usMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  return null;
};

export const formatLocalDate = (dateString?: string, fallback: string = 'N/A'): string => {
  if (!dateString) {
    return fallback;
  }

  const date = parseLocalDate(dateString);
  if (!date || isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

==================================================================================

export interface A2UIResponse {
  success: boolean;
  data: A2UIData;
}

export interface A2UIData {
  response_id: string;
  member_id: string;
  a2ui_json: A2UICommand[];
  title: string;
  primary_intent: string;
  created_at: string;
}

export type A2UICommand = BeginRenderingCommand | SurfaceUpdateCommand;

export interface BeginRenderingCommand {
  beginRendering: {
    surfaceId: string;
    root: string;
    catalogId: string;
    styles: {
      primaryColor: string;
      font: string;
    };
  };
}

export interface SurfaceUpdateCommand {
  surfaceUpdate: {
    surfaceId: string;
    components: ComponentDefinition[];
  };
}

export interface ComponentDefinition {
  id: string;
  component: Component;
  weight?: number;
}

export type Component =
  | { Card: CardComponent }
  | { Column: ColumnComponent }
  | { Row: RowComponent }
  | { Text: TextComponent }
  | { Divider: DividerComponent };

export interface CardComponent {
  child: string;
}

export interface ColumnComponent {
  children: { explicitList: string[] };
  distribution: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround';
  alignment: 'start' | 'center' | 'end' | 'stretch';
}

export interface RowComponent {
  children: { explicitList: string[] };
  distribution: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround';
  alignment: 'start' | 'center' | 'end' | 'stretch';
}

export interface TextComponent {
  text: { literalString: string };
  usageHint: 'h1' | 'h2' | 'h3' | 'h4' | 'body' | 'caption';
}

export interface DividerComponent {
  axis: 'horizontal' | 'vertical';
}

=========================================================================================

export interface BenefitsResponse {
  success: boolean;
  data: BenefitsData;
}

export interface BenefitsData {
  conversation_id: string;
  member_id: string;
  data: BenefitAgentData[];
  detailed_summary: string;
  primary_intent: string;
  created_at: string;
}

export interface BenefitAgentData {
  extracted_text: string;
  plan_info: PlanInfo[];
  follow_up_questions: string[];
  prior_authorization: unknown[];
  status_messages: string[];
  errors: string[];
  has_errors: boolean;
  total_chunks: number;
  total_artifacts: number;
  member_id: string;
  message: string;
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
}

export interface PlanInfo {
  subGroupId: string;
  contractCd: string;
  effectiveDt: string;
  hcId: string;
  mcId: string;
  memberSeqNbr: string;
  coverageKey: string;
  network: string;
  family: string;
  deductibleMet: string;
  outofPocketMet: string;
  planLevel: PlanLevel[];
  network_present_flag: boolean;
}

export interface PlanLevel {
  planType: string;
  benefits: Benefit[];
}

export interface Benefit {
  benefitname: string;
  networks: Network[];
}

export interface Network {
  code: string;
  type: string;
  costshares: CostShare[];
}

export interface CostShare {
  type: string;
  benefitOptDesc: string;
  value: string;
  period?: string;
  coverageLevel?: string;
  accumulatedamt?: string;
  remainingamt?: string;
  accumname?: string;
  accumBasis?: string;
}

=======================================================================================

export interface ClaimsResponse {
  success: boolean;
  data: ClaimsData;
}

export interface ClaimsData {
  conversation_id: string;
  member_id: string;
  data: ClaimAgentData[];
  detailed_summary: string;
  primary_intent: string;
  created_at: string;
}

export interface ClaimAgentData {
  claim_id?: string;
  owner_id?: string;
  query?: string;
  response?: string;
  interactionId?: string;
  agentId?: string;
  sessionId?: string;
  detailService?: string;
  fixedDay?: string;
  topFollowUpQns?: Array<{
    id: string;
    title: string;
    answer: string;
  }>;
  suggestions?: Array<{
    followUpQuestions: string[];
  }>;
  claimDetail?: Record<string, unknown>;
  confidenceScore?: number;
  success?: boolean;
  type?: string;
  language?: string;
  subtype?: string;
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
  claims?: Claim[];
  follow_up_questions?: string[];
  status_messages?: string[];
  errors?: string[];
  has_errors?: boolean;
  total_chunks?: number;
  total_artifacts?: number;
  member_id?: string;
  message?: string;
  extracted_text?: string;
  total_claims?: number;
  show_view_all_message?: boolean;
  requires_selection?: boolean;
  more_claiminfo?: MoreClaimInfo;
  eob_metadata?: EobMetadata;
  eob_document_b64?: string;
}

export interface MoreClaimInfo {
  success: boolean;
  claim_id: string;
  display_fields: DisplayField[];
}

export interface EobMetadata {
  eob_available?: boolean;
  eob_retrieved?: boolean;
  member_message?: string;
}

export interface DisplayField {
  field: string;
  label: string;
  value: string;
}

export interface Claim {
  claim_id: string;
  claim_number?: string;
  service_date?: string;
  service_start_date?: string;
  service_end_date?: string;
  received_date?: string;
  received_date_sms?: string;
  processed_date?: string;
  provider?: string;
  provider_name?: string;
  provider_type?: string;
  claim_type?: string;
  status?: string;
  claim_status?: string;
  total_charge?: string;
  total_charged?: string;
  total_allowed?: string;
  plan_paid?: string;
  member_responsibility?: string;
  deductible?: string;
  coinsurance?: string;
  copay?: string;
  service_description?: string;
  diagnosis_codes?: string[];
  procedure_codes?: string[];
  network_status?: string;
}

export interface ClaimDetail extends Claim {
  patient_name?: string;
  patient_dob?: string;
  subscriber_name?: string;
  group_number?: string;
  claim_lines?: ClaimLine[];
  payment_details?: PaymentDetail[];
  remarks?: string[];
  appeal_rights?: string;
}

export interface ClaimLine {
  line_number: number;
  service_date: string;
  procedure_code: string;
  procedure_description: string;
  diagnosis_codes: string[];
  units: number;
  charged_amount: string;
  allowed_amount: string;
  deductible: string;
  coinsurance: string;
  copay: string;
  paid_amount: string;
  member_owes: string;
  provider_name?: string;
}

export interface PaymentDetail {
  payment_date: string;
  payment_amount: string;
  payment_method: string;
  check_number?: string;
  payee: string;
}

===========================================================================

export interface FindCareResponse {
  success: boolean;
  data: FindCareData;
}

export interface FindCareData {
  conversation_id: string;
  member_id: string;
  data: FindCareAgentData[];
  detailed_summary: string;
  primary_intent: string;
  created_at: string;
}

export interface FindCareAgentData {
  user_journey: UserJourney;
  header: Header;
  entities: Entity[];
  data: ProvidersData;
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
}

export interface UserJourney {
  journey: string;
  subjourney: string;
  task: string;
  subtask: string;
}

export interface Header {
  title: string;
  description: string;
}

export interface Entity {
  name: string;
  values?: string;
  value?: string;
}

export interface ProvidersData {
  providers: Provider[];
}

export interface Provider {
  name: string;
  network: string;
  distance: string | null;
  rating: number | string | null;
  rating_count: number | string | null;
  address: string;
  phone: string;
  specialty: string;
  cost: string | null;
  providerQueryParams: ProviderQueryParams;
  pdtKey: string | null;
}

export interface ProviderQueryParams {
  recordkey: string;
}

========================================================================

export interface IdCardResponse {
  success: boolean;
  data: IdCardData;
}

export interface IdCardData {
  conversation_id: string;
  message_id: string;
  data: IdCardAgentData[];
  sms_summary: string;
  detailed_summary: string | null;
  primary_intent: string;
  created_at: string;
}

export interface IdCardAgentData {
  image_b64_front: string;
  image_b64_back: string;
  member_name?: string;
  type?: string;
  subtype?: string;
  success?: boolean;
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
}

====================================================================

export interface PharmacyResponse {
  success: boolean;
  data: PharmacyData;
}

export interface PharmacyData {
  conversation_id: string;
  message_id: string;
  data: PharmacyAgentData[];
  sms_summary: string;
  detailed_summary: string | null;
  primary_intent: string;
  created_at: string;
}

export interface PharmacyAgentData {
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
  success: boolean;
  response?: string;
  requires_selection?: boolean;
  subtype: string;
  total_orders?: number;
  show_view_all_message?: boolean;
  orders?: PharmacyOrder[];
  extracted_text?: string;
  pharmacy_state?: string;
  order_detail?: PharmacyOrderDetail;
}

export interface PharmacyOrder {
  index: number;
  order_id: string;
  order_number_last4: string;
  order_date: string;
  order_date_sms: string;
  status: string;
  drug_name: string;
  member_name: string;
}

export interface PharmacyOrderDetail {
  order_id: string;
  order_number_last4: string;
  order_date: string;
  order_date_sms: string;
  status: string;
  member: PharmacyMember;
  prescriptions: PharmacyPrescription[];
  financials: PharmacyFinancials;
}

export interface PharmacyMember {
  full_name: string;
  dob: string;
}

export interface PharmacyPrescription {
  order_drug_detail_id: string;
  drug_name: string;
  status: string;
  rx_number: string;
  days_supply: string;
  prescriber_name: string;
  quantity: number;
  total_cost: string;
}

export interface PharmacyFinancials {
  sales_tax: string;
  shipping: string;
  total_price: string;
  amount_plan_paid: string;
  your_responsibility: string;
  payment_method: string;
  amount_paid: string;
  remaining_balance: string;
}

=========================================================

export interface PlanInfoResponse {
  success: boolean;
  data: PlanInfoData;
}

export interface PlanInfoData {
  conversation_id: string;
  message_id: string;
  data: PlanInfoAgentData[];
  sms_summary: string;
  detailed_summary: string | null;
  primary_intent: string;
  created_at: string;
  language?: string;
}

export interface PlanInfoAgentData {
  message?: string;
  plan_page?: PlanPage;
  _agent_name: string;
  _agent_label?: string;
  _intent_priority?: string;
}

export interface PlanPageDetail {
  label: string;
  value: string;
}

export interface PlanPage {
  header: string;
  details: PlanPageDetail[];
  notes: string[];
  life_events_label?: string | null;
  life_events_url?: string | null;
}

=======================================================

export interface PriorAuthResponse {
  success: boolean;
  data: PriorAuthData;
}

export interface PriorAuthData {
  conversation_id: string;
  message_id: string;
  data: PriorAuthAgentData[];
  sms_summary: string;
  detailed_summary: string | null;
  primary_intent: string;
  created_at: string;
}

export interface PriorAuthAgentData {
  authorizations: Authorization[];
  total_count: number;
  status_filter?: string;
  date_range?: DateRange;
  show_view_all_message: boolean;
  _agent_name: string;
  _agent_label: string;
  _intent_priority: string;
  type: string;
  subtype: string;
  success: boolean;
  highlighted_auth_id?: string;
}

export interface Authorization {
  reference_number: string;
  processed_date: string;
  service_requested: string;
  requested_by: string;
  status: string;
  status_reason: string;
  last_updated: string;
  member_name: string;
}

export interface DateRange {
  start: string;
  end: string;
}

======================================================

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Mic, Plus, Send } from 'lucide-react';

import { environmentConfig } from '../config/environments';

interface Member {
  id: string;
  name: string;
}

const VERIZON_MEMBERS: Member[] = [
  { id: '381266501', name: 'JOHN SMITH' },
  { id: '348345174', name: 'NATHANAEL GRABOWSKI' },
  { id: '348618581', name: 'Verizon Member1' },
  { id: '348345174', name: 'Verizon Member2 (Find Care)' },
  { id: '387546880', name: 'Verizon Member3 (Claims)' },
];

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  detailUrl?: string;
  timestamp: Date;
}

function parseResponseSummary(raw: string): { body: string; url: string | null } {
  // Support multiple localized link labels appended by the backend summarizer
  // English: "View details:", "View more:", "View more claims", "View your EOB:"
  // Spanish: "Ver detalles:", "Ver más:", "Ver más reclamos", "Ver su EOB:"
  const labels = [
    'View details',
    'View more',
    'View more claims',
    'View your EOB',
    'Ver detalles',
    'Ver más',
    'Ver más reclamos',
    'Ver su EOB',
  ];

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternation = labels.map(escapeRegex).join('|');
  // Match any supported label optionally followed by a colon, whitespace, then a URL
  const linkPattern = new RegExp(`(?:${alternation})(?::)?\\s*(https?:\\/\\/\\S+)`, 'i');

  const match = raw.match(linkPattern);
  if (match) {
    const url = match[1].trim();
    const body = raw.replace(linkPattern, '').trim();
    return { body, url };
  }
  return { body: raw.trim(), url: null };
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const URL_TEST = /^https?:\/\/[^\s]+$/;

function linkify(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (URL_TEST.test(part)) {
      const prevText = typeof nodes[nodes.length - 1] === 'string' ? (nodes.pop() as string) : '';
      const trimmed = prevText.trimEnd();
      const phraseMatch = trimmed.match(/^([\s\S]*?)([^.!?\n]+)$/);
      const prefix = phraseMatch ? phraseMatch[1].trimEnd() : '';
      const label = phraseMatch ? phraseMatch[2].trim() : trimmed.trim() || 'View link';
      if (prefix) {
        nodes.push(`${prefix} `);
      }
      nodes.push(
        <a
          // eslint-disable-next-line react/no-array-index-key
          key={`${keyPrefix}-url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 font-medium underline underline-offset-2"
        >
          {label} →
        </a>
      );
    } else {
      nodes.push(part);
    }
  }
  return nodes;
}

export function ChatbotPage() {
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [talkBannerOpen, setTalkBannerOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const memberDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target as Node)) {
        setMemberDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || !selectedMember || loading) {
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setLoading(true);

    try {
      const response = await fetch(`${environmentConfig.apiBaseUrl}/search/horizon/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_content: text,
          mbrUid: selectedMember.id,
          channel: 'sms',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rawSummary: string =
        data?.response_summary ??
        data?.message_content ??
        data?.response ??
        data?.answer ??
        data?.text ??
        JSON.stringify(data, null, 2);
      const { body, url } = parseResponseSummary(rawSummary);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: body,
          detailUrl: url ?? undefined,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'error',
          content: err instanceof Error ? err.message : 'An unexpected error occurred.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-gray-200 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl flex flex-col" style={{ height: '100vh' }}>
        {/* Black Top Header */}
        <div className="bg-black px-5 py-4 flex items-center justify-between flex-shrink-0">
          <h1 className="text-white text-xl font-bold tracking-tight">Ask Verizon</h1>
          <ChevronDown className="w-5 h-5 text-white" />
        </div>

        {/* "Want to talk to a person?" Banner */}
        <div className="bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => setTalkBannerOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-4"
          >
            <span className="text-sm font-semibold text-gray-900">Want to talk to a person?</span>
            <ChevronDown
              className={`w-5 h-5 text-red-600 transition-transform ${talkBannerOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Member Selector */}
        <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex-shrink-0" ref={memberDropdownRef}>
          <div className="relative">
            <button
              onClick={() => setMemberDropdownOpen((o) => !o)}
              className="w-full flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-gray-300 hover:border-gray-400 transition-colors bg-white"
            >
              <span className={selectedMember ? 'text-gray-900 font-medium' : 'text-gray-400'}>
                {selectedMember ? `${selectedMember.name} — ID: ${selectedMember.id}` : 'Select a member...'}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-gray-500 transition-transform ${memberDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {memberDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                {VERIZON_MEMBERS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedMember(m);
                      setMemberDropdownOpen(false);
                      setMessages([]);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 transition-colors border-b border-gray-100 last:border-0 ${
                      selectedMember?.id === m.id ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-700'
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-gray-400 text-xs">ID: {m.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ backgroundColor: '#f0f0f0' }}>
          {!selectedMember && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-gray-500 font-medium text-sm">Select a member above to begin</p>
            </div>
          )}

          <div className="space-y-1">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} mb-2`}>
                <div
                  className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-red-600 text-white'
                      : msg.role === 'error'
                        ? 'bg-white text-red-600 border border-red-200'
                        : 'bg-white text-gray-800'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="space-y-1.5">
                      {msg.content.split('\n').map((line, i) => {
                        const trimmed = line.trim();
                        if (!trimmed) {
                          return null;
                        }
                        return (
                          // eslint-disable-next-line react/no-array-index-key
                          <p key={`${msg.id}-line-${i}`} className="text-sm text-gray-800 leading-relaxed">
                            {linkify(trimmed, `${msg.id}-line-${i}`)}
                          </p>
                        );
                      })}
                      {msg.detailUrl && (
                        <a
                          href={msg.detailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1 text-red-600 hover:text-red-800 text-xs font-medium underline underline-offset-2 break-all"
                        >
                          View full details →
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1 px-1">{formatTime(msg.timestamp)}</p>
              </div>
            ))}

            {loading && (
              <div className="flex items-start mb-2">
                <div className="bg-white px-4 py-3 rounded-2xl shadow-sm">
                  <div className="flex gap-1 items-center">
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-gray-100 px-4 py-4 flex-shrink-0">
          <div
            className={`bg-white rounded-3xl border-2 px-4 pt-3 pb-2 transition-colors ${inputFocused ? 'border-red-600' : 'border-red-300'}`}
          >
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!selectedMember || loading}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="How can we help you today?"
              rows={2}
              className="w-full resize-none text-sm text-gray-700 placeholder-gray-400 focus:outline-none bg-transparent disabled:cursor-not-allowed"
              style={{ maxHeight: '100px', overflowY: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
              }}
            />
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-100">
              <button className="text-gray-500 hover:text-gray-700 transition-colors p-1" aria-label="Attach">
                <Plus className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <button className="text-gray-500 hover:text-gray-700 transition-colors p-1" aria-label="Voice input">
                  <Mic className="w-5 h-5" />
                </button>
                <button
                  onClick={sendMessage}
                  disabled={!selectedMember || !inputValue.trim() || loading}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors p-1"
                  aria-label="Send"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

=============================================================================================

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { A2UIRenderer } from '../components/A2UIRenderer';
import { BenefitsRenderer } from '../components/BenefitsRenderer';
import { ClaimDetailRenderer } from '../components/ClaimDetailRenderer';
import { ClaimsBecaDirectCallRenderer } from '../components/ClaimsBecaDirectCallRenderer';
import { ClaimsSearchListRenderer } from '../components/ClaimsSearchListRenderer';
import { ClaimsSummaryRenderer } from '../components/ClaimsSummaryRenderer';
import { ErrorDisplay } from '../components/ErrorDisplay';
import { ExpiredLinkDisplay } from '../components/ExpiredLinkDisplay';
import { FindCareRenderer } from '../components/FindCareRenderer';
import { IdCardRenderer } from '../components/IdCardRenderer';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { NoDataDisplay } from '../components/NoDataDisplay';
import { PharmacyOrderDetailRenderer } from '../components/PharmacyOrderDetailRenderer';
import { PharmacyOrdersRenderer } from '../components/PharmacyOrdersRenderer';
import { PlanInfoRenderer } from '../components/PlanInfoRenderer';
import { PriorAuthListRenderer } from '../components/PriorAuthListRenderer';
import { environmentConfig } from '../config/environments';
import { A2UIResponse } from '../types/a2ui';
import { BenefitsResponse } from '../types/benefits';
import { ClaimsResponse } from '../types/claims';
import { FindCareResponse } from '../types/findcare';
import { IdCardResponse } from '../types/idcard';
import { PharmacyResponse } from '../types/pharmacy';
import { PlanInfoResponse } from '../types/planInfo';
import { PriorAuthResponse } from '../types/priorAuth';
import { getTranslations } from '../utils/i18n';

type ViewType =
  | 'a2ui'
  | 'benefits'
  | 'findcare'
  | 'claims_summary'
  | 'claims_detail'
  | 'claims_search_list'
  | 'claims_beca_direct_call'
  | 'prior_auth_list'
  | 'pharmacy_orders'
  | 'pharmacy_order_detail'
  | 'id_card'
  | 'plan_info'
  | 'unknown';

export function DataViewPage() {
  const [searchParams] = useSearchParams();
  const [viewType, setViewType] = useState<ViewType>('unknown');
  const [a2uiData, setA2UIData] = useState<A2UIResponse | null>(null);
  const [benefitsData, setBenefitsData] = useState<BenefitsResponse | null>(null);
  const [findCareData, setFindCareData] = useState<FindCareResponse | null>(null);
  const [claimsData, setClaimsData] = useState<ClaimsResponse | null>(null);
  const [priorAuthData, setPriorAuthData] = useState<PriorAuthResponse | null>(null);
  const [pharmacyData, setPharmacyData] = useState<PharmacyResponse | null>(null);
  const [idCardData, setIdCardData] = useState<IdCardResponse | null>(null);
  const [planInfoData, setPlanInfoData] = useState<PlanInfoResponse | null>(null);
  const [language, setLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const messageId = searchParams.get('message_id');

      if (messageId) {
        setLoading(true);
        setError(null);
        setLinkExpired(null);

        try {
          const apiUrl = `${environmentConfig.apiBaseUrl}/data?message_id=${messageId}`;

          const response = await fetch(apiUrl);

          if (response.status === 410) {
            const errorBody = await response.json().catch(() => null);
            const responseLanguage = errorBody?.detail?.language ?? 'en';
            setLanguage(responseLanguage);
            setLinkExpired(getTranslations(responseLanguage).linkExpiredMessage);
            return;
          }

          if (!response.ok) {
            throw new Error(`Unable to load data. Please check your URL parameters.`);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const jsonData: any = await response.json();

          if (!jsonData.success) {
            throw new Error('Unable to load data. The server returned an unsuccessful response.');
          }

          const detectedLanguage = jsonData.data?.language || 'en';
          setLanguage(detectedLanguage);

          const agentName = jsonData.data?.data?.[0]?._agent_name;
          const responseType = jsonData.data?.data?.[0]?.type;
          const subtype = jsonData.data?.data?.[0]?.subtype;
          const agentSuccess = jsonData.data?.data?.[0]?.success;

          if (
            jsonData.success &&
            agentName === 'CLAIMS_DETAIL' &&
            subtype === 'claims_beca_direct_call' &&
            agentSuccess === true
          ) {
            setViewType('claims_beca_direct_call');
            setClaimsData(jsonData as ClaimsResponse);
          } else if (
            jsonData.success &&
            agentName === 'CLAIMS_DETAIL' &&
            subtype === 'claims_search_list' &&
            agentSuccess === true
          ) {
            setViewType('claims_search_list');
            setClaimsData(jsonData as ClaimsResponse);
          } else if (responseType === 'date_search_claims' && agentName === 'CLAIMS_DETAIL') {
            setViewType('claims_summary');
            setClaimsData(jsonData as ClaimsResponse);
          } else if (responseType === 'becca_claims' && agentName === 'CLAIMS_DETAIL') {
            setViewType('claims_detail');
            setClaimsData(jsonData as ClaimsResponse);
          } else if (agentName === 'benefits' || agentName === 'BENEFITS_OVERVIEW') {
            setViewType('benefits');
            setBenefitsData(jsonData as BenefitsResponse);
          } else if (agentName === 'findcare' || agentName === 'REVIEW_PROVIDERS') {
            setViewType('findcare');
            setFindCareData(jsonData as FindCareResponse);
          } else if (agentName === 'PRIOR_AUTHORIZATION_OVERVIEW' && subtype === 'prior_auth_list') {
            setViewType('prior_auth_list');
            setPriorAuthData(jsonData as PriorAuthResponse);
          } else if (agentName === 'PHARMACY' && subtype === 'pharmacy_orders_list') {
            setViewType('pharmacy_orders');
            setPharmacyData(jsonData as PharmacyResponse);
          } else if (agentName === 'PHARMACY' && subtype === 'pharmacy_order_detail') {
            setViewType('pharmacy_order_detail');
            setPharmacyData(jsonData as PharmacyResponse);
          } else if (agentName === 'ID_CARD') {
            setViewType('id_card');
            setIdCardData(jsonData as IdCardResponse);
          } else if ((agentName || '').toLowerCase() === 'plan_info' || jsonData.data?.data?.[0]?.plan_page) {
            setViewType('plan_info');
            setPlanInfoData(jsonData as PlanInfoResponse);
          } else if (jsonData.data?.a2ui_json) {
            setViewType('a2ui');
            setA2UIData(jsonData as A2UIResponse);
          } else {
            throw new Error(`Unknown type: ${responseType || 'undefined'} with agent: ${agentName || 'undefined'}`);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch data');
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };

    fetchData();
  }, [searchParams]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (linkExpired) {
    return <ExpiredLinkDisplay message={linkExpired} language={language} />;
  }

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  if (viewType === 'benefits' && benefitsData) {
    return <BenefitsRenderer data={benefitsData.data} language={language} />;
  }

  if (viewType === 'findcare' && findCareData) {
    return <FindCareRenderer data={findCareData.data} language={language} />;
  }

  if (viewType === 'claims_beca_direct_call' && claimsData) {
    return <ClaimsBecaDirectCallRenderer data={claimsData.data} language={language} />;
  }

  if (viewType === 'claims_search_list' && claimsData) {
    return <ClaimsSearchListRenderer data={claimsData.data} language={language} />;
  }

  if (viewType === 'claims_summary' && claimsData) {
    return <ClaimsSummaryRenderer data={claimsData.data} language={language} />;
  }

  if (viewType === 'claims_detail' && claimsData) {
    return <ClaimDetailRenderer data={claimsData.data} language={language} />;
  }

  if (viewType === 'prior_auth_list' && priorAuthData) {
    return <PriorAuthListRenderer data={priorAuthData.data} language={language} />;
  }

  if (viewType === 'pharmacy_orders' && pharmacyData) {
    return <PharmacyOrdersRenderer data={pharmacyData.data} language={language} />;
  }

  if (viewType === 'pharmacy_order_detail' && pharmacyData) {
    return <PharmacyOrderDetailRenderer data={pharmacyData.data} language={language} />;
  }

  if (viewType === 'id_card' && idCardData) {
    return <IdCardRenderer data={idCardData.data} language={language} />;
  }

  if (viewType === 'plan_info' && planInfoData) {
    return <PlanInfoRenderer data={planInfoData.data} language={language} />;
  }

  if (viewType === 'a2ui' && a2uiData) {
    return <A2UIRenderer data={a2uiData.data} />;
  }

  return <NoDataDisplay />;
}

==============================================================================================

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, FlaskConical, RotateCcw, Send } from 'lucide-react';

import { environmentConfig } from '../config/environments';

// ─── Types ───────────────────────────────────────────────────────────────────

type FlowType = 'member_id' | 'auth' | null;
type Channel = 'sms' | 'web';
type SetupStep = 'flow' | 'channel' | 'member_id' | 'phone' | 'ready';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'system';
  content: string;
  timestamp: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const URL_TEST = /^https?:\/\/[^\s]+$/;

function linkify(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (URL_TEST.test(part)) {
      nodes.push(
        <a
          key={`${keyPrefix}-url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
        >
          {part}
        </a>
      );
    } else {
      nodes.push(part);
    }
  }
  return nodes;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function systemMsg(content: string): Message {
  return { id: crypto.randomUUID(), role: 'system', content, timestamp: new Date() };
}

// ─── Setup Sidebar ────────────────────────────────────────────────────────────

interface SetupConfig {
  flow: FlowType;
  channel: Channel | null;
  memberId: string;
  phoneNumber: string;
}

interface SetupSidebarProps {
  config: SetupConfig;
  isReady: boolean;
  onReset: () => void;
}

function SetupSidebar({ config, isReady, onReset }: SetupSidebarProps) {
  const row = (label: string, value: string | null, done: boolean) => (
    <div className="flex items-start gap-2 py-2 border-b border-gray-700 last:border-0">
      <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${done ? 'text-green-400' : 'text-gray-600'}`} />
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
        <p className={`text-sm font-medium ${done ? 'text-white' : 'text-gray-600'}`}>{value ?? '—'}</p>
      </div>
    </div>
  );

  return (
    <div className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col">
      <div className="px-4 py-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-indigo-400" />
          <span className="text-white font-bold text-sm tracking-wide">Test Config</span>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-0 overflow-y-auto">
        {row(
          'Flow',
          config.flow === 'member_id' ? 'Member ID' : config.flow === 'auth' ? 'Auth Flow' : null,
          !!config.flow
        )}
        {row('Channel', config.channel ? config.channel.toUpperCase() : null, !!config.channel)}
        {config.flow === 'member_id' && row('Member ID', config.memberId || null, !!config.memberId)}
        {config.flow === 'auth' && row('Phone', config.phoneNumber || null, !!config.phoneNumber)}
        {row('Status', isReady ? 'Ready ✓' : 'Setup…', isReady)}
      </div>

      <div className="px-4 py-4 border-t border-gray-700">
        <button
          onClick={onReset}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Session
        </button>
      </div>
    </div>
  );
}

// ─── Request / Response Inspector ────────────────────────────────────────────

interface InspectorEntry {
  id: string;
  request: object;
  requestHeaders: Record<string, string>;
  response: object | string;
  status: number;
  durationMs: number;
  timestamp: Date;
}

interface InspectorPanelProps {
  entries: InspectorEntry[];
}

function InspectorPanel({ entries }: InspectorPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const entry = entries.find((e) => e.id === selected) ?? entries[entries.length - 1] ?? null;

  if (entries.length === 0) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-950 border-l border-gray-700 flex items-center justify-center">
        <p className="text-gray-600 text-xs text-center px-4">API calls will appear here</p>
      </div>
    );
  }

  return (
    <div className="w-80 flex-shrink-0 bg-gray-950 border-l border-gray-700 flex flex-col text-xs">
      <div className="px-3 py-2.5 border-b border-gray-700 text-gray-400 font-semibold uppercase tracking-wide text-xs">
        API Inspector
      </div>

      {/* Call list */}
      <div className="flex-shrink-0 max-h-32 overflow-y-auto border-b border-gray-700">
        {[...entries].reverse().map((e) => (
          <button
            key={e.id}
            onClick={() => setSelected(e.id)}
            className={`w-full text-left px-3 py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800 transition-colors ${
              selected === e.id || (!selected && e === entries[entries.length - 1]) ? 'bg-gray-800' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`font-mono font-bold ${e.status >= 200 && e.status < 300 ? 'text-green-400' : 'text-red-400'}`}
              >
                {e.status}
              </span>
              <span className="text-gray-500">{e.durationMs}ms</span>
            </div>
            <div className="text-gray-500 truncate mt-0.5">{formatTime(e.timestamp)}</div>
          </button>
        ))}
      </div>

      {/* Detail */}
      {entry && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <p className="text-gray-500 uppercase tracking-wide mb-1">Request Headers</p>
            <pre className="text-green-300 font-mono whitespace-pre-wrap break-all bg-gray-900 rounded p-2">
              {JSON.stringify(entry.requestHeaders, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wide mb-1">Request Body</p>
            <pre className="text-green-300 font-mono whitespace-pre-wrap break-all bg-gray-900 rounded p-2">
              {JSON.stringify(entry.request, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-gray-500 uppercase tracking-wide mb-1">Response ({entry.status})</p>
            <pre className="text-blue-300 font-mono whitespace-pre-wrap break-all bg-gray-900 rounded p-2">
              {typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function InternalTestChatbotPage() {
  // Setup wizard state
  const [setupStep, setSetupStep] = useState<SetupStep>('flow');
  const [flow, setFlow] = useState<FlowType>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [memberId, setMemberId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFirstMessage, setIsFirstMessage] = useState(true);
  const [inspectorEntries, setInspectorEntries] = useState<InspectorEntry[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setupInputRef = useRef<HTMLInputElement>(null);
  const prevLoadingRef = useRef(false);

  const isReady = setupStep === 'ready';

  const config: SetupConfig = { flow, channel, memberId, phoneNumber };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus setup input when step changes
  useEffect(() => {
    if (setupStep === 'member_id' || setupStep === 'phone') {
      setTimeout(() => setupInputRef.current?.focus(), 100);
    }
  }, [setupStep]);

  // Auto-focus the chat input when setup is complete
  useEffect(() => {
    if (isReady) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isReady]);

  // Refocus chat input only when loading transitions from true → false (after API response)
  useEffect(() => {
    if (prevLoadingRef.current && !loading && isReady) {
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, isReady]);

  // Seed initial system prompt
  useEffect(() => {
    setMessages([
      systemMsg("Welcome to the Internal API Test Console. Let's configure your test session."),
      systemMsg('Step 1 of 3 — Choose a flow type below.'),
    ]);
  }, []);

  // ── Setup Wizard Handlers ──────────────────────────────────────────────────

  const handleFlowSelect = (selected: FlowType) => {
    setFlow(selected);
    setSetupStep('channel');
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: selected === 'member_id' ? 'Member ID Flow' : 'Authentication Flow',
        timestamp: new Date(),
      },
      systemMsg('Step 2 of 3 — Select the channel to test.'),
    ]);
  };

  const handleChannelSelect = (selected: Channel) => {
    setChannel(selected);
    const nextStep = flow === 'member_id' ? 'member_id' : 'phone';
    setSetupStep(nextStep);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: selected.toUpperCase(), timestamp: new Date() },
      systemMsg(
        flow === 'member_id'
          ? 'Step 3 of 3 — Enter the Member ID to use for this session.'
          : 'Step 3 of 3 — Enter the phone number for authentication.'
      ),
    ]);
  };

  const handleSetupSubmit = () => {
    if (setupStep === 'member_id') {
      const trimmed = memberId.trim();
      if (!trimmed) {
        return;
      }
      setSetupStep('ready');
      setIsFirstMessage(true);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: new Date() },
        systemMsg(
          `Session configured. You are testing with Member ID ${trimmed} over ${channel?.toUpperCase()}. Type your first message below.`
        ),
      ]);
    } else if (setupStep === 'phone') {
      const trimmed = phoneNumber.trim();
      if (!trimmed) {
        return;
      }
      setSetupStep('ready');
      setIsFirstMessage(true);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: new Date() },
        systemMsg(
          `Session configured. Auth flow via ${channel?.toUpperCase()} with phone ${trimmed}. The first request will include the reset_conversation header. Type your first message below.`
        ),
      ]);
    }
  };

  const handleReset = () => {
    setSetupStep('flow');
    setFlow(null);
    setChannel(null);
    setMemberId('');
    setPhoneNumber('');
    setInputValue('');
    setIsFirstMessage(true);
    setInspectorEntries([]);
    setMessages([
      systemMsg('Session reset. Choose a flow type to start a new session.'),
      systemMsg('Step 1 of 3 — Choose a flow type below.'),
    ]);
  };

  // ── API Call ───────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || !isReady || loading) {
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setLoading(true);

    const requestBody =
      flow === 'member_id'
        ? { message_content: text, mbrUid: memberId, channel: channel! }
        : { message_content: text, from: phoneNumber, channel: channel! };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (flow === 'auth' && isFirstMessage) {
      requestHeaders.reset_conversation = 'true';
    }

    const startTime = Date.now();

    try {
      const response = await fetch(`${environmentConfig.apiBaseUrl}/search/horizon/orchestrate`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
      });

      const durationMs = Date.now() - startTime;
      let responseData: object | string;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      const inspectorEntry: InspectorEntry = {
        id: crypto.randomUUID(),
        request: requestBody,
        requestHeaders,
        response: responseData,
        status: response.status,
        durationMs,
        timestamp: new Date(),
      };
      setInspectorEntries((prev) => [...prev, inspectorEntry]);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (isFirstMessage) {
        setIsFirstMessage(false);
      }

      const data = responseData as Record<string, unknown>;
      const rawSummary: string =
        (data?.response_summary as string) ??
        (data?.message_content as string) ??
        (data?.response as string) ??
        (data?.answer as string) ??
        (data?.text as string) ??
        JSON.stringify(responseData, null, 2);

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: rawSummary.trim(), timestamp: new Date() },
      ]);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (inspectorEntries.length === 0 || inspectorEntries[inspectorEntries.length - 1].durationMs !== durationMs) {
        setInspectorEntries((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            request: requestBody,
            requestHeaders,
            response: err instanceof Error ? err.message : 'Unknown error',
            status: 0,
            durationMs,
            timestamp: new Date(),
          },
        ]);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'error',
          content: err instanceof Error ? err.message : 'An unexpected error occurred.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleSetupKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSetupSubmit();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <SetupSidebar config={config} isReady={isReady} onReset={handleReset} />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-gray-900 border-b border-gray-700 px-5 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-5 h-5 text-indigo-400" />
            <div>
              <h1 className="text-white font-bold text-base leading-tight">Internal API Test Console</h1>
              <p className="text-gray-400 text-xs">
                {isReady
                  ? `${flow === 'member_id' ? `MbrUID: ${memberId}` : `Phone: ${phoneNumber}`} · ${channel?.toUpperCase()} · ${
                      environmentConfig.name
                    }`
                  : 'Complete setup to begin testing'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                isReady ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isReady ? 'bg-green-400' : 'bg-yellow-400'}`} />
              {isReady ? 'Active' : 'Setup'}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.map((msg) => {
            if (msg.role === 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-full max-w-lg text-center">
                    {msg.content}
                  </span>
                </div>
              );
            }

            const isUser = msg.role === 'user';
            const isError = msg.role === 'error';

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white'
                      : isError
                        ? 'bg-red-900 text-red-300 border border-red-700'
                        : 'bg-gray-700 text-gray-100'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="space-y-1">
                      {msg.content
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => {
                          const trimmed = line.trim();
                          const lineKey = `${msg.id}-${trimmed.slice(0, 32)}`;
                          return (
                            <p key={lineKey} className="leading-relaxed">
                              {linkify(trimmed, lineKey)}
                            </p>
                          );
                        })}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1 px-1">{formatTime(msg.timestamp)}</p>
              </div>
            );
          })}

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-start">
              <div className="bg-gray-700 px-4 py-3 rounded-2xl">
                <div className="flex gap-1 items-center">
                  {(['0ms', '150ms', '300ms'] as const).map((delay) => (
                    <span
                      key={delay}
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: delay }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Setup widgets rendered inline after system prompts */}
          {setupStep === 'flow' && (
            <div className="flex justify-center gap-3 pt-1">
              <button
                onClick={() => handleFlowSelect('member_id')}
                className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-gray-700 hover:bg-indigo-700 border border-gray-600 hover:border-indigo-500 text-white transition-all group"
              >
                <span className="text-2xl">🪪</span>
                <span className="text-sm font-semibold">Member ID Flow</span>
                <span className="text-xs text-gray-400 group-hover:text-indigo-200 text-center max-w-28">
                  Skip auth, pass mbrUid directly
                </span>
              </button>
              <button
                onClick={() => handleFlowSelect('auth')}
                className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-gray-700 hover:bg-indigo-700 border border-gray-600 hover:border-indigo-500 text-white transition-all group"
              >
                <span className="text-2xl">🔐</span>
                <span className="text-sm font-semibold">Authentication Flow</span>
                <span className="text-xs text-gray-400 group-hover:text-indigo-200 text-center max-w-28">
                  Use phone number + reset_conversation header
                </span>
              </button>
            </div>
          )}

          {setupStep === 'channel' && (
            <div className="flex justify-center gap-3 pt-1">
              {(['sms', 'web'] as Channel[]).map((ch) => (
                <button
                  key={ch}
                  onClick={() => handleChannelSelect(ch)}
                  className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-gray-700 hover:bg-indigo-700 border border-gray-600 hover:border-indigo-500 text-white transition-all"
                >
                  <span>{ch === 'sms' ? '📱' : '🌐'}</span>
                  <div className="text-left">
                    <p className="text-sm font-semibold">{ch.toUpperCase()}</p>
                    <p className="text-xs text-gray-400">{ch === 'sms' ? 'SMS channel' : 'Web channel'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {(setupStep === 'member_id' || setupStep === 'phone') && (
            <div className="flex justify-center pt-1">
              <div className="flex items-center gap-2 w-full max-w-sm">
                <input
                  ref={setupInputRef}
                  type={setupStep === 'phone' ? 'tel' : 'text'}
                  value={setupStep === 'member_id' ? memberId : phoneNumber}
                  onChange={(e) =>
                    setupStep === 'member_id' ? setMemberId(e.target.value) : setPhoneNumber(e.target.value)
                  }
                  onKeyDown={handleSetupKeyDown}
                  placeholder={setupStep === 'member_id' ? 'e.g. 381266502' : 'e.g. 7325551234'}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
                <button
                  onClick={handleSetupSubmit}
                  disabled={setupStep === 'member_id' ? !memberId.trim() : !phoneNumber.trim()}
                  className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-gray-900 border-t border-gray-700 px-5 py-4 flex-shrink-0">
          {!isReady ? (
            <p className="text-center text-gray-500 text-xs py-1">Complete the setup above to start chatting</p>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1 bg-gray-700 rounded-2xl border border-gray-600 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all px-4 py-3">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  placeholder="Type your test message…"
                  autoFocus
                  rows={1}
                  className="w-full resize-none text-sm text-white placeholder-gray-500 focus:outline-none bg-transparent disabled:cursor-not-allowed"
                  style={{ maxHeight: '120px', overflowY: 'auto' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                  }}
                />
              </div>
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || loading}
                className="p-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
          {isReady && flow === 'auth' && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              {isFirstMessage
                ? '⚡ Next request will include reset_conversation header'
                : '✓ Subsequent requests sent without reset_conversation'}
            </p>
          )}
        </div>
      </div>

      {/* API Inspector Panel */}
      <InspectorPanel entries={inspectorEntries} />
    </div>
  );
}

=================================================================================

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FileUpload } from '../components/FileUpload';
import { environmentConfig } from '../config/environments';

export function UploadPage() {
  const [searchParams] = useSearchParams();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleSubmit = async (file: File, question?: string) => {
    const sessionId = searchParams.get('session_id');

    if (!sessionId) {
      setUploadError('Unable to process upload. Please try again or contact support.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(false);

    try {
      const apiUrl = `${environmentConfig.apiBaseUrl}/document/upload`;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('session_id', sessionId);

      if (question) {
        formData.append('user_query', question);
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      console.log('Upload successful:', result);
      setUploadSuccess(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload document';
      console.error('Upload error:', errorMessage);
      setUploadError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setUploadSuccess(false);
    setUploadError(null);
  };

  return (
    <FileUpload
      onSubmit={handleSubmit}
      onReset={handleReset}
      isUploading={isUploading}
      uploadError={uploadError}
      uploadSuccess={uploadSuccess}
    />
  );
}

================================================================================

export interface EnvironmentConfig {
  apiBaseUrl: string;
  name: string;
  hosts: string[];
}

const ENVIRONMENTS: EnvironmentConfig[] = [
  {
    name: 'Local Development',
    apiBaseUrl: 'http://localhost:8000',
    hosts: ['localhost', '127.0.0.1'],
  },
  {
    name: 'Development',
    apiBaseUrl: 'https://va-dev.075462445880.awsdns.internal.das/virtual-assistant',
    hosts: ['alb-dev'],
  },
  {
    name: 'System Integration Testing',
    apiBaseUrl: 'https://va-sit.075462445880.awsdns.internal.das/virtual-assistant',
    hosts: ['alb-sit'],
  },
  {
    name: 'User Acceptance Testing',
    apiBaseUrl: 'https://dtwin-uat.elegancehealth.com/virtual-assistant',
    hosts: ['dtwin-uat.elegancehealth.com'],
  },
  {
    name: 'Production',
    apiBaseUrl: 'https://dtwin.elegancehealth.com/virtual-assistant',
    hosts: ['dtwin.elegancehealth.com'],
  },
];

const FALLBACK = ENVIRONMENTS[1];

const resolveConfig = (): EnvironmentConfig => {
  const hostname = window.location.hostname.toLowerCase();
  return ENVIRONMENTS.find((env) => env.hosts.some((h) => hostname === h || hostname.includes(h))) ?? FALLBACK;
};

export const environmentConfig: EnvironmentConfig = resolveConfig();

===========================================================================================

import React from 'react';

import {
  A2UIData,
  CardComponent,
  ColumnComponent,
  ComponentDefinition,
  DividerComponent,
  RowComponent,
  TextComponent,
} from '../types/a2ui';

interface A2UIRendererProps {
  data: A2UIData;
}

export const A2UIRenderer: React.FC<A2UIRendererProps> = ({ data }) => {
  const beginRendering = data.a2ui_json.find((cmd) => 'beginRendering' in cmd);
  const surfaceUpdate = data.a2ui_json.find((cmd) => 'surfaceUpdate' in cmd);

  if (!beginRendering || !surfaceUpdate || !('surfaceUpdate' in surfaceUpdate)) {
    return <div className="text-red-500">Invalid A2UI data structure</div>;
  }

  const styles = 'beginRendering' in beginRendering ? beginRendering.beginRendering.styles : null;
  const components = surfaceUpdate.surfaceUpdate.components;
  const rootId = 'beginRendering' in beginRendering ? beginRendering.beginRendering.root : '';

  const componentMap = new Map<string, ComponentDefinition>();
  components.forEach((comp) => {
    componentMap.set(comp.id, comp);
  });

  const renderComponent = (id: string): React.ReactNode => {
    const compDef = componentMap.get(id);
    if (!compDef) {
      return null;
    }

    const { component, weight } = compDef;

    if ('Card' in component) {
      return renderCard(component.Card, id);
    } else if ('Column' in component) {
      return renderColumn(component.Column, id);
    } else if ('Row' in component) {
      return renderRow(component.Row, id);
    } else if ('Text' in component) {
      return renderText(component.Text, id, weight);
    } else if ('Divider' in component) {
      return renderDivider(component.Divider, id);
    }

    return null;
  };

  const renderCard = (card: CardComponent, id: string): React.ReactNode => {
    return (
      <div
        key={id}
        className="bg-white rounded-lg shadow-lg p-6 max-w-3xl mx-auto"
        style={{ borderTop: `4px solid ${styles?.primaryColor || '#0B5FFF'}` }}
      >
        {renderComponent(card.child)}
      </div>
    );
  };

  const renderColumn = (column: ColumnComponent, id: string): React.ReactNode => {
    const alignmentClass = {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    }[column.alignment];

    const distributionClass = {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      spaceBetween: 'justify-between',
      spaceAround: 'justify-around',
    }[column.distribution];

    return (
      <div key={id} className={`flex flex-col ${alignmentClass} ${distributionClass} gap-4`}>
        {column.children.explicitList.map((childId) => renderComponent(childId))}
      </div>
    );
  };

  const renderRow = (row: RowComponent, id: string): React.ReactNode => {
    const alignmentClass = {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    }[row.alignment];

    const distributionClass = {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      spaceBetween: 'justify-between',
      spaceAround: 'justify-around',
    }[row.distribution];

    return (
      <div key={id} className={`flex flex-row w-full ${alignmentClass} ${distributionClass} gap-4 py-2`}>
        {row.children.explicitList.map((childId) => renderComponent(childId))}
      </div>
    );
  };

  const renderText = (text: TextComponent, id: string, weight?: number): React.ReactNode => {
    const usageHintClass = {
      h1: 'text-4xl font-bold text-gray-900',
      h2: 'text-3xl font-bold text-gray-900',
      h3: 'text-2xl font-semibold text-gray-900',
      h4: 'text-xl font-semibold text-gray-900',
      body: 'text-base text-gray-700',
      caption: 'text-sm text-gray-500',
    }[text.usageHint];

    // When weight is specified, use flex-grow and flex-shrink for proper sizing
    const flexClass = weight ? 'flex-1' : '';

    return (
      <div key={id} className={`${usageHintClass} ${flexClass}`}>
        {text.text.literalString}
      </div>
    );
  };

  const renderDivider = (divider: DividerComponent, id: string): React.ReactNode => {
    if (divider.axis === 'horizontal') {
      return <hr key={id} className="border-t border-gray-200 my-2" />;
    } else {
      return <div key={id} className="border-l border-gray-200 mx-2 h-full" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">{renderComponent(rootId)}</div>
  );
};

=============================================================================================

import React, { useState } from 'react';

import { Benefit, BenefitsData, Network } from '../types/benefits';
import { getTranslations } from '../utils/i18n';

interface BenefitsRendererProps {
  data: BenefitsData;
  language?: string;
}

export const BenefitsRenderer: React.FC<BenefitsRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const [activeNetwork, setActiveNetwork] = useState<'INN' | 'OON'>('INN');

  const agentData = data.data[0];
  const planInfo = agentData?.plan_info?.[0];

  if (!planInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noBenefitInfo}</p>
        </div>
      </div>
    );
  }

  const medicalPlan = planInfo.planLevel.find((p) => p.planType === 'Medical');
  const benefits = medicalPlan?.benefits || [];

  const getNetworkData = (benefit: Benefit): Network | undefined => {
    return benefit.networks.find(
      (n) => n.code === activeNetwork || (activeNetwork === 'INN' && n.code.startsWith('INN'))
    );
  };

  const formatCurrency = (value: string): string => {
    const numericValue = value.replace(/[$,]/g, '');
    const num = parseFloat(numericValue);
    if (isNaN(num)) {
      return value;
    }
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const calculateProgress = (accumulated: string, total: string): number => {
    const acc = parseFloat(accumulated.replace(/[$,]/g, ''));
    const tot = parseFloat(total.replace(/[$,]/g, ''));
    return tot > 0 ? (acc / tot) * 100 : 0;
  };

  const renderDeductibleCard = () => {
    const deductible = benefits.find((b) => b.benefitname === 'Deductible');
    if (!deductible) {
      return null;
    }

    const networkData = getNetworkData(deductible);
    if (!networkData) {
      return null;
    }

    const individual = networkData.costshares.find((c) => c.coverageLevel === 'Individual');
    const family = networkData.costshares.find((c) => c.coverageLevel === 'Family');

    return (
      <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <svg className="w-6 h-6 text-blue-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
            {translations.deductible}
          </h3>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              activeNetwork === 'INN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
            }`}
          >
            {networkData.type}
          </span>
        </div>

        {individual && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{translations.individual}</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(individual.value)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  activeNetwork === 'INN' ? 'bg-blue-500' : 'bg-orange-500'
                }`}
                style={{ width: `${calculateProgress(individual.accumulatedamt || '0', individual.value)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>
                {translations.met}: {formatCurrency(individual.accumulatedamt || '$0')}
              </span>
              <span>
                {translations.remaining}: {formatCurrency(individual.remainingamt || individual.value)}
              </span>
            </div>
          </div>
        )}

        {family && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">
                {translations.family}
                {family.accumBasis && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                    {family.accumBasis}
                  </span>
                )}
              </span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(family.value)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  activeNetwork === 'INN' ? 'bg-blue-500' : 'bg-orange-500'
                }`}
                style={{ width: `${calculateProgress(family.accumulatedamt || '0', family.value)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>
                {translations.met}: {formatCurrency(family.accumulatedamt || '$0')}
              </span>
              <span>
                {translations.remaining}: {formatCurrency(family.remainingamt || family.value)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderOOPCard = () => {
    const oop = benefits.find((b) => b.benefitname === 'Out-of-Pocket Maximum');
    if (!oop) {
      return null;
    }

    const networkData = getNetworkData(oop);
    if (!networkData) {
      return null;
    }

    const individual = networkData.costshares.find((c) => c.coverageLevel === 'Individual');
    const family = networkData.costshares.find((c) => c.coverageLevel === 'Family');

    return (
      <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <svg className="w-6 h-6 text-green-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            {translations.outOfPocketMax}
          </h3>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              activeNetwork === 'INN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
            }`}
          >
            {networkData.type}
          </span>
        </div>

        {individual && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{translations.individual}</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(individual.value)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-green-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${calculateProgress(individual.accumulatedamt || '0', individual.value)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>
                {translations.spent}: {formatCurrency(individual.accumulatedamt || '$0')}
              </span>
              <span>
                {translations.remaining}: {formatCurrency(individual.remainingamt || individual.value)}
              </span>
            </div>
          </div>
        )}

        {family && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">
                {translations.family}
                {family.accumBasis && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                    {family.accumBasis}
                  </span>
                )}
              </span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(family.value)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-green-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${calculateProgress(family.accumulatedamt || '0', family.value)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>
                {translations.spent}: {formatCurrency(family.accumulatedamt || '$0')}
              </span>
              <span>
                {translations.remaining}: {formatCurrency(family.remainingamt || family.value)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.myBenefits}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Plan Summary */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{translations.medicalPlanSummary}</h2>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 inline-flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
              {planInfo.family === 'yes' ? translations.family : translations.individual}
            </span>
          </div>

          {(data.detailed_summary || agentData?.extracted_text) && (
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg mt-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                <svg className="w-5 h-5 text-blue-500 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                {data.detailed_summary || agentData?.extracted_text}
              </p>
            </div>
          )}
        </div>

        {/* Network Toggle */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setActiveNetwork('INN')}
              className={`px-6 py-2 rounded-md font-medium text-sm transition-all ${
                activeNetwork === 'INN' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-4 h-4 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              {translations.inNetwork}
            </button>
            <button
              onClick={() => setActiveNetwork('OON')}
              className={`px-6 py-2 rounded-md font-medium text-sm transition-all ${
                activeNetwork === 'OON' ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-4 h-4 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              {translations.outOfNetwork}
            </button>
          </div>
        </div>

        {/* Benefits Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderDeductibleCard()}
          {renderOOPCard()}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.benefitsSummaryNote}
          </p>
        </div>
      </footer>
    </div>
  );
};

=============================================================================================

import React, { useState } from 'react';

import { ClaimDetail, ClaimsData } from '../types/claims';
import { formatLocalDate } from '../utils/dateUtils';
import { getTranslations } from '../utils/i18n';

interface ClaimDetailRendererProps {
  data: ClaimsData;
  language?: string;
}

export const ClaimDetailRenderer: React.FC<ClaimDetailRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const [activeTab, setActiveTab] = useState<'overview' | 'breakdown' | 'payment'>('overview');

  console.log('ClaimDetailRenderer - Full data:', JSON.stringify(data, null, 2));

  const agentData = data.data[0];
  console.log('ClaimDetailRenderer - agentData:', agentData);

  // Handle becca_claims structure (response text) or traditional claims array
  const claim = agentData?.claims?.[0] as ClaimDetail;

  // Safely extract string values, handling both string and object cases
  let claimId: string | undefined;
  let responseText: string | undefined;
  let query: string | undefined;

  if (agentData) {
    claimId = typeof agentData.claim_id === 'string' ? agentData.claim_id : undefined;

    // Handle response - could be string or object with nested structure
    if (typeof agentData.response === 'string') {
      responseText = agentData.response;
    } else if (agentData.response && typeof agentData.response === 'object') {
      // Try to extract answer from topics array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseObj = agentData.response as any;
      if (Array.isArray(responseObj.topics) && responseObj.topics.length > 0) {
        const firstTopic = responseObj.topics[0];
        responseText = firstTopic.answer || JSON.stringify(agentData.response, null, 2);
      } else {
        responseText = JSON.stringify(agentData.response, null, 2);
      }
    }

    query = typeof agentData.query === 'string' ? agentData.query : undefined;
  }

  console.log('ClaimDetailRenderer - Extracted values:', { claimId, responseText, query });

  // Extract follow-up questions from multiple possible sources
  let topFollowUpQns: Array<{ id: string; title: string; answer: string }> = [];

  // Try topFollowUpQns first
  if (Array.isArray(agentData?.topFollowUpQns)) {
    topFollowUpQns = agentData.topFollowUpQns.filter(
      (faq): faq is { id: string; title: string; answer: string } =>
        faq &&
        typeof faq === 'object' &&
        'id' in faq &&
        'title' in faq &&
        'answer' in faq &&
        typeof faq.id === 'string' &&
        typeof faq.title === 'string' &&
        typeof faq.answer === 'string'
    );
  }

  // If no topFollowUpQns, try to extract from response.topics
  if (topFollowUpQns.length === 0 && agentData?.response && typeof agentData.response === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseObj = agentData.response as any;
    if (Array.isArray(responseObj.topics)) {
      topFollowUpQns = responseObj.topics
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((topic: any) => topic && topic.title && topic.answer)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((topic: any, index: number) => ({
          id: topic.id || `topic-${index}`,
          title: topic.title,
          answer: topic.answer,
        }));
    }
  }

  console.log('ClaimDetailRenderer - topFollowUpQns:', topFollowUpQns);

  if (!claim && !responseText) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noClaimDetailsAvailable}</p>
        </div>
      </div>
    );
  }

  // If we have a response text (becca_claims), render with Benefits page style
  if (responseText && !claim) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseObj = agentData?.response as any;

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header matching Benefits page */}
        <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.claimDetails}</h1>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {/* Claim Summary Card */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{translations.claimSummary}</h2>
                {claimId && (
                  <p className="text-sm text-gray-600 mt-1">
                    {translations.claimNumber}
                    {claimId}
                  </p>
                )}
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 inline-flex items-center">
                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path
                    fillRule="evenodd"
                    d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                    clipRule="evenodd"
                  />
                </svg>
                {translations.medicalClaim}
              </span>
            </div>

            {/* Response Text with blue info box */}
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
              <p className="text-sm text-gray-700 leading-relaxed">
                <svg className="w-5 h-5 text-blue-500 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                {responseText}
              </p>
            </div>
          </div>

          {/* Claim Details Card */}
          {claimId && (
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Claim Information</h3>

              {/* Information Grid */}
              <div className="space-y-4">
                {query && (
                  <div className="flex justify-between items-start py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600 font-medium">{translations.query}</span>
                    <span className="text-sm text-gray-900 text-right max-w-md">{query}</span>
                  </div>
                )}

                {responseObj?.status && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600 font-medium">{translations.status}</span>
                    <div className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-sm text-gray-900 font-medium">{responseObj.status}</span>
                    </div>
                  </div>
                )}

                {responseObj?.agentId && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600 font-medium">{translations.billedBy}</span>
                    <span className="text-sm text-gray-900">{responseObj.agentId}</span>
                  </div>
                )}

                {responseObj?.dateOfService && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600 font-medium">{translations.serviceDateLabel}</span>
                    <span className="text-sm text-gray-900">{responseObj.dateOfService}</span>
                  </div>
                )}

                <div className="flex justify-between items-center py-3">
                  <span className="text-sm text-gray-600 font-medium">What you pay (in-network)</span>
                  <span className="text-lg text-gray-900 font-bold">$0.00</span>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-center text-sm text-gray-600">
              <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              {translations.claimsNote}
            </p>
          </div>
        </footer>
      </div>
    );
  }

  const getStatusColor = (status?: string): string => {
    if (!status) {
      return 'bg-gray-100 text-gray-800 border-gray-200';
    }
    const statusLower = status.toLowerCase();
    if (statusLower.includes('paid') || statusLower.includes('processed')) {
      return 'bg-green-100 text-green-800 border-green-200';
    }
    if (statusLower.includes('pending') || statusLower.includes('processing')) {
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    }
    if (statusLower.includes('denied') || statusLower.includes('rejected')) {
      return 'bg-red-100 text-red-800 border-red-200';
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const renderOverviewTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <svg className="w-6 h-6 text-blue-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {translations.claimInformation}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">{translations.claimNumberLabel}</p>
            <p className="text-base font-semibold text-gray-900">{claim.claim_number}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">{translations.claimTypeLabel}</p>
            <p className="text-base font-semibold text-gray-900">{claim.claim_type}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">{translations.serviceDateLabel}</p>
            <p className="text-base font-semibold text-gray-900">{formatLocalDate(claim.service_date)}</p>
          </div>
          {claim.processed_date && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{translations.processedDate}</p>
              <p className="text-base font-semibold text-gray-900">{formatLocalDate(claim.processed_date)}</p>
            </div>
          )}
          {claim.network_status && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{translations.networkStatus}</p>
              <p className="text-base font-semibold text-gray-900">{claim.network_status}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <svg className="w-6 h-6 text-purple-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          {translations.providerInformation}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">{translations.providerNameLabel}</p>
            <p className="text-base font-semibold text-gray-900">{claim.provider_name}</p>
          </div>
          {claim.provider_type && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{translations.providerTypeLabel}</p>
              <p className="text-base font-semibold text-gray-900">{claim.provider_type}</p>
            </div>
          )}
        </div>

        {claim.service_description && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">{translations.serviceDescription}</p>
            <p className="text-base text-gray-900">{claim.service_description}</p>
          </div>
        )}
      </div>

      {claim.patient_name && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <svg className="w-6 h-6 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            {translations.patientInformation}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-500 mb-1">{translations.patientName}</p>
              <p className="text-base font-semibold text-gray-900">{claim.patient_name}</p>
            </div>
            {claim.patient_dob && (
              <div>
                <p className="text-sm text-gray-500 mb-1">{translations.dateOfBirth}</p>
                <p className="text-base font-semibold text-gray-900">{formatLocalDate(claim.patient_dob)}</p>
              </div>
            )}
            {claim.subscriber_name && (
              <div>
                <p className="text-sm text-gray-500 mb-1">{translations.subscriberName}</p>
                <p className="text-base font-semibold text-gray-900">{claim.subscriber_name}</p>
              </div>
            )}
            {claim.group_number && (
              <div>
                <p className="text-sm text-gray-500 mb-1">{translations.groupNumber}</p>
                <p className="text-base font-semibold text-gray-900">{claim.group_number}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {claim.diagnosis_codes && claim.diagnosis_codes.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <svg className="w-6 h-6 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            {translations.diagnosisCodes}
          </h3>

          <div className="flex flex-wrap gap-2">
            {claim.diagnosis_codes.map((code) => (
              <span key={code} className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium">
                {code}
              </span>
            ))}
          </div>
        </div>
      )}

      {claim.remarks && claim.remarks.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <svg className="w-6 h-6 text-yellow-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            {translations.remarks}
          </h3>

          <ul className="space-y-2">
            {claim.remarks.map((remark) => (
              <li key={remark} className="flex items-start">
                <svg
                  className="w-5 h-5 text-yellow-500 mr-2 mt-0.5 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm text-gray-700">{remark}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const renderBreakdownTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-6">{translations.costBreakdown}</h3>

        <div className="space-y-4">
          <div className="flex justify-between items-center pb-4 border-b border-gray-200">
            <span className="text-gray-700 font-medium">{translations.totalCharged}</span>
            <span className="text-xl font-bold text-gray-900">{claim.total_charged}</span>
          </div>

          <div className="flex justify-between items-center pb-4 border-b border-gray-200">
            <span className="text-gray-700 font-medium">{translations.totalAllowed}</span>
            <span className="text-xl font-bold text-gray-900">{claim.total_allowed}</span>
          </div>

          {claim.deductible && (
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <div>
                <span className="text-gray-700 font-medium">{translations.deductible}</span>
                <p className="text-xs text-gray-500 mt-1">{translations.appliedToAnnualDeductible}</p>
              </div>
              <span className="text-lg font-semibold text-blue-600">{claim.deductible}</span>
            </div>
          )}

          {claim.coinsurance && (
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <div>
                <span className="text-gray-700 font-medium">{translations.coinsurance}</span>
                <p className="text-xs text-gray-500 mt-1">{translations.yourShareAfterDeductible}</p>
              </div>
              <span className="text-lg font-semibold text-purple-600">{claim.coinsurance}</span>
            </div>
          )}

          {claim.copay && (
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <div>
                <span className="text-gray-700 font-medium">{translations.copay}</span>
                <p className="text-xs text-gray-500 mt-1">{translations.fixedAmountForService}</p>
              </div>
              <span className="text-lg font-semibold text-indigo-600">{claim.copay}</span>
            </div>
          )}

          <div className="flex justify-between items-center pb-4 border-b border-gray-200">
            <span className="text-gray-700 font-medium">{translations.planPaid}</span>
            <span className="text-xl font-bold text-green-600">{claim.plan_paid}</span>
          </div>

          <div className="flex justify-between items-center pt-2">
            <span className="text-lg font-bold text-gray-900">{translations.yourResponsibility}</span>
            <span className="text-2xl font-bold text-orange-600">{claim.member_responsibility}</span>
          </div>
        </div>
      </div>

      {claim.claim_lines && claim.claim_lines.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{translations.serviceLineItems}</h3>

          <div className="space-y-4">
            {claim.claim_lines.map((line) => (
              <div key={line.line_number} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-semibold">
                        {translations.line} {line.line_number}
                      </span>
                      <span className="text-sm text-gray-600">{formatLocalDate(line.service_date)}</span>
                    </div>
                    <h4 className="font-semibold text-gray-900">{line.procedure_description}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {translations.code}: {line.procedure_code} | {translations.units}: {line.units}
                    </p>
                    {line.provider_name && (
                      <p className="text-sm text-gray-600">
                        {translations.providerNameLabel}: {line.provider_name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500">{translations.charged}</p>
                    <p className="text-sm font-semibold text-gray-900">{line.charged_amount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{translations.allowed}</p>
                    <p className="text-sm font-semibold text-gray-900">{line.allowed_amount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{translations.planPaid}</p>
                    <p className="text-sm font-semibold text-green-600">{line.paid_amount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{translations.youOwe}</p>
                    <p className="text-sm font-semibold text-orange-600">{line.member_owes}</p>
                  </div>
                </div>

                {line.diagnosis_codes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-2">{translations.diagnosisCodes}</p>
                    <div className="flex flex-wrap gap-1">
                      {line.diagnosis_codes.map((code) => (
                        <span
                          key={`${line.line_number}-${code}`}
                          className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderPaymentTab = () => (
    <div className="space-y-6">
      {claim.payment_details && claim.payment_details.length > 0 ? (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{translations.paymentHistory}</h3>

          <div className="space-y-4">
            {claim.payment_details.map((payment) => (
              <div
                key={`${payment.payment_date}-${payment.payment_amount}`}
                className="border border-gray-200 rounded-lg p-4"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-gray-900">{payment.payee}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {formatLocalDate(payment.payment_date)} • {payment.payment_method}
                    </p>
                    {payment.check_number && (
                      <p className="text-sm text-gray-600">
                        {translations.checkNumber}
                        {payment.check_number}
                      </p>
                    )}
                  </div>
                  <span className="text-xl font-bold text-green-600">{payment.payment_amount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-gray-600">{translations.noPaymentInfo}</p>
          </div>
        </div>
      )}

      {claim.appeal_rights && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-r-lg">
          <h4 className="font-semibold text-blue-900 mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.appealRights}
          </h4>
          <p className="text-sm text-blue-800">{claim.appeal_rights}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-100">
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">{translations.claimDetails}</h1>
              <p className="text-blue-100 mt-1">
                {translations.claimNumber}
                {claim.claim_number}
              </p>
            </div>
            <button className="px-4 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {translations.backToClaims}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {data.detailed_summary && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
              <p className="text-sm text-gray-700 leading-relaxed">
                <svg className="w-5 h-5 text-blue-500 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                {data.detailed_summary}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{claim.provider_name}</h2>
              <p className="text-gray-600 mt-1">
                {translations.serviceDateLabel}: {formatLocalDate(claim.service_date)}
              </p>
            </div>
            <span
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 ${getStatusColor(claim.claim_status)}`}
            >
              {claim.claim_status}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {translations.overview}
              </button>
              <button
                onClick={() => setActiveTab('breakdown')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'breakdown'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                {translations.breakdown}
              </button>
              <button
                onClick={() => setActiveTab('payment')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'payment'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                {translations.payment}
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && renderOverviewTab()}
            {activeTab === 'breakdown' && renderBreakdownTab()}
            {activeTab === 'payment' && renderPaymentTab()}
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.claimsNote}
          </p>
        </div>
      </footer>
    </div>
  );
};

=================================================================================================

import React from 'react';

import { ClaimsData, DisplayField } from '../types/claims';
import { getTranslations } from '../utils/i18n';

interface ClaimsBecaDirectCallRendererProps {
  data: ClaimsData;
  language?: string;
}

export const ClaimsBecaDirectCallRenderer: React.FC<ClaimsBecaDirectCallRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  console.log('ClaimsBecaDirectCallRenderer - Full data:', JSON.stringify(data, null, 2));

  const agentData = data.data[0];
  console.log('ClaimsBecaDirectCallRenderer - agentData:', agentData);

  const shouldShowEobButton = Boolean(agentData?.eob_metadata?.eob_retrieved && agentData?.eob_document_b64);

  const handleDownloadEob = () => {
    try {
      const b64 = String(agentData?.eob_document_b64 || '');
      if (!b64) return;
      const commaIndex = b64.indexOf(',');
      const pureB64 = commaIndex >= 0 ? b64.slice(commaIndex + 1) : b64;
      const byteChars = atob(pureB64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'EOB.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to download EOB PDF', e);
    }
  };

  let claimId: string | undefined;
  let responseText: string | undefined;

  if (agentData) {
    claimId = typeof agentData.claim_id === 'string' ? agentData.claim_id : undefined;

    if (typeof agentData.response === 'string') {
      responseText = agentData.response;
    } else if (agentData.response && typeof agentData.response === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseObj = agentData.response as any;
      if (Array.isArray(responseObj.topics) && responseObj.topics.length > 0) {
        const firstTopic = responseObj.topics[0];
        responseText = firstTopic.answer || JSON.stringify(agentData.response, null, 2);
      } else {
        responseText = JSON.stringify(agentData.response, null, 2);
      }
    }
  }

  if (!agentData || !responseText) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noClaimInfo}</p>
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responseObj = agentData?.response as any;

  console.log('ClaimsBecaDirectCallRenderer - responseObj:', responseObj);
  console.log('ClaimsBecaDirectCallRenderer - more_claiminfo:', responseObj?.more_claiminfo);
  console.log('ClaimsBecaDirectCallRenderer - display_fields:', responseObj?.more_claiminfo?.display_fields);

  // Check if more_claiminfo exists at agentData level
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moreClaimInfo = responseObj?.more_claiminfo || (agentData as any)?.more_claiminfo;
  console.log('ClaimsBecaDirectCallRenderer - moreClaimInfo:', moreClaimInfo);

  // Extract memberscript value for top display
  const memberScriptField = moreClaimInfo?.display_fields?.find(
    (field: DisplayField) => field.field === 'member_script'
  );
  console.log('ClaimsBecaDirectCallRenderer - memberScriptField:', memberScriptField);
  console.log('ClaimsBecaDirectCallRenderer - all fields:', moreClaimInfo?.display_fields);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl sm:text-3xl font-bold">{translations.claimDetails}</h1>
          {claimId && (
            <p className="text-blue-100 mt-1">
              {translations.claimNumber}
              {claimId}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {shouldShowEobButton && (
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Explanation of Benefits</h2>
              <button
                type="button"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
                onClick={handleDownloadEob}
              >
                Download PDF
              </button>
            </div>
          </div>
        )}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{translations.claimSummary}</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 inline-flex items-center">
                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path
                    fillRule="evenodd"
                    d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                    clipRule="evenodd"
                  />
                </svg>
                {translations.medicalClaim}
              </span>
              {null}
            </div>
          </div>


          {memberScriptField && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-700 leading-relaxed">{memberScriptField.value}</p>
            </div>
          )}
        </div>

        {moreClaimInfo?.display_fields &&
          moreClaimInfo.display_fields.length > 0 &&
          (() => {
            // Separate fields into primary info and cost breakdown
            const costBreakdownFields = ['deductible', 'coinsurance', 'copay', 'amount_not_covered'];
            const primaryFields = moreClaimInfo.display_fields.filter(
              (field: DisplayField) => !costBreakdownFields.includes(field.field)
            );
            const breakdownFields = moreClaimInfo.display_fields.filter((field: DisplayField) =>
              costBreakdownFields.includes(field.field)
            );
            const whatYouPayField = moreClaimInfo.display_fields.find(
              (field: DisplayField) => field.field === 'what_you_pay'
            );

            return (
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-6">{translations.claimInformation}</h3>

                <div className="space-y-4">
                  {/* Primary fields (excluding what_you_pay, member_script, member, and cost breakdown) */}
                  {primaryFields.map((field: DisplayField) => {
                    if (field.field === 'what_you_pay' || field.field === 'member_script' || field.field === 'member') {
                      return null;
                    }
                    const isStatusField = field.field === 'status';

                    return (
                      <div
                        key={field.field}
                        className="flex justify-between items-center py-3 border-b border-gray-200"
                      >
                        <span className="text-sm text-gray-600 font-medium">{field.label}</span>
                        {isStatusField ? (
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <span className="text-sm text-gray-900 font-medium">{field.value}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-900">{field.value}</span>
                        )}
                      </div>
                    );
                  })}

                  {/* What you pay - Primary highlight */}
                  {whatYouPayField && (
                    <div className="py-4 border-b-2 border-gray-300">
                      <div className="flex justify-between items-center">
                        <span className="text-base text-gray-900 font-semibold">{whatYouPayField.label}</span>
                        <span className="text-2xl text-gray-900 font-bold">{whatYouPayField.value}</span>
                      </div>

                      {/* Cost breakdown subsection */}
                      {breakdownFields.length > 0 && (
                        <div className="mt-4 pl-4 space-y-2">
                          {breakdownFields.map((field: DisplayField) => (
                            <div key={field.field} className="flex justify-between items-center py-2">
                              <span className="text-sm text-gray-500">{field.label}</span>
                              <span className="text-sm text-gray-700">{field.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        {agentData?.follow_up_questions && agentData.follow_up_questions.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              {translations.relatedQuestions}
            </h3>

            <div className="space-y-2">
              {agentData.follow_up_questions.map((question) => (
                <div key={question} className="flex items-start">
                  <svg
                    className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm text-gray-700">{question}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.claimsNote}
          </p>
        </div>
      </footer>
    </div>
  );
};

=============================================================================================

import React from 'react';

import { ClaimsData } from '../types/claims';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { getTranslations } from '../utils/i18n';

interface ClaimsSearchListRendererProps {
  data: ClaimsData;
  language?: string;
}

export const ClaimsSearchListRenderer: React.FC<ClaimsSearchListRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  console.log('ClaimsSearchListRenderer - Full data:', JSON.stringify(data, null, 2));

  const agentData = data.data[0];
  console.log('ClaimsSearchListRenderer - agentData:', agentData);

  const claims = agentData?.claims || [];
  const totalClaims = agentData?.total_claims || claims.length;
  const showViewAllMessage = agentData?.show_view_all_message;

  console.log('ClaimsSearchListRenderer - claims:', claims);
  console.log('ClaimsSearchListRenderer - totalClaims:', totalClaims);

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noClaimsInfo}</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status?: string): string => {
    if (!status) {
      return 'bg-gray-100 text-gray-800';
    }
    const statusLower = status.toLowerCase();
    if (statusLower.includes('paid') || statusLower.includes('processed')) {
      return 'bg-green-100 text-green-800';
    }
    if (statusLower.includes('pending') || statusLower.includes('processing')) {
      return 'bg-yellow-100 text-yellow-800';
    }
    if (statusLower.includes('denied') || statusLower.includes('rejected') || statusLower.includes('reject')) {
      return 'bg-red-100 text-red-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status?: string) => {
    if (!status) {
      return null;
    }
    const statusLower = status.toLowerCase();
    if (statusLower.includes('paid') || statusLower.includes('processed')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('pending') || statusLower.includes('processing')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('denied') || statusLower.includes('rejected') || statusLower.includes('reject')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    );
  };

  const sortedClaims = [...claims].sort((a, b) => {
    const dateA = a.service_start_date || a.service_date || a.received_date || '';
    const dateB = b.service_start_date || b.service_date || b.received_date || '';
    const parsedA = parseLocalDate(dateA);
    const parsedB = parseLocalDate(dateB);
    const timeA = parsedA ? parsedA.getTime() : 0;
    const timeB = parsedB ? parsedB.getTime() : 0;
    return timeB - timeA;
  });

  const formatCurrency = (amount: string | number) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount.replace(/[$,]/g, '')) : amount;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numAmount);
  };

  const getLastFourDigits = (claimId: string) => {
    return claimId.slice(-4);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.claimsSearchResults}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {translations.found} {totalClaims}{' '}
              {totalClaims === 1 ? translations.foundClaim : translations.foundClaims}
            </h2>
            {showViewAllMessage && (
              <span className="text-sm text-blue-600 font-medium">
                {translations.showing} {claims.length} {translations.of} {totalClaims}
              </span>
            )}
          </div>

          <div className="space-y-4">
            {sortedClaims.length === 0 ? (
              <div className="text-center py-12">
                <svg
                  className="w-16 h-16 text-gray-400 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-600">{translations.noClaimsFound}</p>
              </div>
            ) : (
              sortedClaims.map((claim) => {
                const providerValue = claim.provider || claim.provider_name;
                const providerName =
                  providerValue === 'N/A' || !providerValue ? translations.notAvailable : providerValue;
                const status = claim.status || claim.claim_status || 'Unknown';
                const serviceDate = claim.service_start_date || claim.service_date;
                const receivedDate = claim.received_date_sms || claim.received_date;
                const totalCharged = claim.total_charge || claim.total_charged || '0.00';
                const memberResponsibility = claim.member_responsibility || '0.00';
                const lastFour = getLastFourDigits(claim.claim_id);

                return (
                  <div
                    key={claim.claim_id}
                    className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-lg text-gray-900">
                              {translations.claimEnding} {lastFour}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {translations.serviceOn} {serviceDate ? formatLocalDate(serviceDate) : 'N/A'}
                            </p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusColor(status)}`}
                          >
                            {getStatusIcon(status)}
                            {status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
                          {receivedDate && (
                            <div>
                              <p className="text-xs text-gray-500 mb-1">{translations.receivedDate}</p>
                              <p className="text-sm font-medium text-gray-900">{formatLocalDate(receivedDate)}</p>
                            </div>
                          )}
                          {claim.claim_type && (
                            <div>
                              <p className="text-xs text-gray-500 mb-1">{translations.type}</p>
                              <p className="text-sm font-medium text-gray-900">{claim.claim_type}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs text-gray-500 mb-1">{translations.totalCharge}</p>
                            <p className="text-sm font-medium text-gray-900">{formatCurrency(totalCharged)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">{translations.youPay}</p>
                            <p className="text-sm font-bold text-blue-600">{formatCurrency(memberResponsibility)}</p>
                          </div>
                        </div>

                        {providerName !== translations.notAvailable && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-500">{translations.provider}</p>
                            <p className="text-sm text-gray-900 mt-1">{providerName}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {showViewAllMessage && claims.length < totalClaims && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      {translations.youHave} {totalClaims - claims.length}{' '}
                      {totalClaims - claims.length === 1 ? translations.moreClaim : translations.moreClaims}.{' '}
                      {translations.replyAll}
                      <strong>ALL</strong> {translations.toViewCompleteList}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

===============================================================================================

import React from 'react';

import { ClaimsData } from '../types/claims';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { getTranslations } from '../utils/i18n';

interface ClaimsSummaryRendererProps {
  data: ClaimsData;
  language?: string;
}

export const ClaimsSummaryRenderer: React.FC<ClaimsSummaryRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  console.log('ClaimsSummaryRenderer - Full data:', JSON.stringify(data, null, 2));

  const agentData = data.data[0];
  console.log('ClaimsSummaryRenderer - agentData:', agentData);

  const claims = agentData?.claims || [];
  console.log('ClaimsSummaryRenderer - claims:', claims);

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noClaimsInfo}</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status?: string): string => {
    if (!status) {
      return 'bg-gray-100 text-gray-800';
    }
    const statusLower = status.toLowerCase();
    if (statusLower.includes('paid') || statusLower.includes('processed')) {
      return 'bg-green-100 text-green-800';
    }
    if (statusLower.includes('pending') || statusLower.includes('processing')) {
      return 'bg-yellow-100 text-yellow-800';
    }
    if (statusLower.includes('denied') || statusLower.includes('rejected') || statusLower.includes('reject')) {
      return 'bg-red-100 text-red-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status?: string) => {
    if (!status) {
      return null;
    }
    const statusLower = status.toLowerCase();
    if (statusLower.includes('paid') || statusLower.includes('processed')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('pending') || statusLower.includes('processing')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('denied') || statusLower.includes('rejected')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    );
  };

  const sortedClaims = [...claims].sort((a, b) => {
    const dateA = a.service_start_date || a.service_date || a.received_date || '';
    const dateB = b.service_start_date || b.service_date || b.received_date || '';
    const parsedA = parseLocalDate(dateA);
    const parsedB = parseLocalDate(dateB);
    const timeA = parsedA ? parsedA.getTime() : 0;
    const timeB = parsedB ? parsedB.getTime() : 0;
    return timeB - timeA;
  });

  const totalCharged = claims.reduce((sum, claim) => {
    const amount = claim.total_charge || claim.total_charged || '0';
    return sum + parseFloat(amount.replace(/[$,]/g, ''));
  }, 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-100">
      <header className="bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.myClaims}</h1>
            <p className="text-purple-100 mt-1">{translations.viewAndTrackClaims}</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {(data.detailed_summary || agentData?.response) && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
              <p className="text-sm text-gray-700 leading-relaxed">
                <svg className="w-5 h-5 text-blue-500 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                {data.detailed_summary || agentData?.response}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{translations.totalCharged}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(totalCharged)}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">{translations.claimsSummary}</h2>
          </div>

          <div className="space-y-4">
            {sortedClaims.length === 0 ? (
              <div className="text-center py-12">
                <svg
                  className="w-16 h-16 text-gray-400 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-600">{translations.noClaimsMatchingFilters}</p>
              </div>
            ) : (
              sortedClaims.map((claim) => {
                const providerValue = claim.provider || claim.provider_name;
                const providerName =
                  providerValue === 'N/A' || !providerValue ? translations.notAvailable : providerValue;
                const claimNumber = claim.claim_number || claim.claim_id;
                const status = claim.status || claim.claim_status || 'Unknown';
                const serviceDate = claim.service_start_date || claim.service_date || claim.received_date;
                const claimAmount = claim.total_charge || claim.total_charged || '$0.00';

                return (
                  <div
                    key={claim.claim_id}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              <span className="text-sm text-gray-600 font-normal">{translations.providerName}</span>
                              {providerName}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {translations.claimNumber}
                              {claimNumber}
                            </p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusColor(status)}`}
                          >
                            {getStatusIcon(status)}
                            {status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                          {serviceDate && (
                            <div>
                              <p className="text-xs text-gray-500">{translations.serviceDate}</p>
                              <p className="text-sm font-medium text-gray-900">{formatLocalDate(serviceDate)}</p>
                            </div>
                          )}
                          {claim.received_date && (
                            <div>
                              <p className="text-xs text-gray-500">{translations.receivedDate}</p>
                              <p className="text-sm font-medium text-gray-900">
                                {formatLocalDate(claim.received_date)}
                              </p>
                            </div>
                          )}
                          {claim.claim_type && (
                            <div>
                              <p className="text-xs text-gray-500">{translations.claimType}</p>
                              <p className="text-sm font-medium text-gray-900">{claim.claim_type}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs text-gray-500">{translations.totalCharged}</p>
                            <p className="text-sm font-medium text-gray-900">{claimAmount}</p>
                          </div>
                        </div>

                        {claim.service_description && (
                          <p className="text-sm text-gray-600 mt-3 italic">{claim.service_description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.claimsNote}
          </p>
        </div>
      </footer>
    </div>
  );
};

=====================================================================================================

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error }) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <h2 className="text-2xl font-bold text-gray-900">Error</h2>
        </div>
        <p className="text-gray-700">{error}</p>
      </div>
    </div>
  );
};

===========================================================================================

import React from 'react';
import { LinkIcon } from 'lucide-react';

import { getTranslations } from '../utils/i18n';

interface ExpiredLinkDisplayProps {
  message: string;
  language?: string;
}

export const ExpiredLinkDisplay: React.FC<ExpiredLinkDisplayProps> = ({ message, language }) => {
  const translations = getTranslations(language);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
        <div className="flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mx-auto mb-4">
          <LinkIcon className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">{translations.linkExpiredTitle}</h2>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
};

============================================================================================

import { ChangeEvent, DragEvent, lazy, Suspense, useRef, useState } from 'react';
import { Eye, FileText, Image as ImageIcon, Upload, X } from 'lucide-react';

const PdfPreview = lazy(() => import('./PdfPreview').then((module) => ({ default: module.PdfPreview })));

const ALLOWED_EXTENSIONS = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FileUploadProps {
  onSubmit?: (file: File, question?: string) => void | Promise<void>;
  onReset?: () => void;
  isUploading?: boolean;
  uploadError?: string | null;
  uploadSuccess?: boolean;
}

export function FileUpload({
  onSubmit,
  onReset,
  isUploading = false,
  uploadError = null,
  uploadSuccess = false,
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (fileToValidate: File): string | null => {
    const extension = fileToValidate.name.split('.').pop()?.toLowerCase();

    if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
      return `Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }

    if (fileToValidate.size > MAX_FILE_SIZE) {
      return `File size exceeds 10MB limit`;
    }

    return null;
  };

  const handleFile = (selectedFile: File) => {
    const validationError = validateFile(selectedFile);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setFile(selectedFile);

    const fileType = selectedFile.type;
    if (fileType.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else if (fileType === 'application/pdf') {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
    }
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFile(selectedFile);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setError(null);
    setShowPreview(false);
    setNumPages(0);
    setPageNumber(1);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onReset?.();
  };

  const handleSubmit = async () => {
    if (file && onSubmit) {
      await onSubmit(file);
    }
  };

  const renderPreview = () => {
    if (!file || !previewUrl) {
      return null;
    }

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';

    return (
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-800">Preview</h3>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Eye className="w-4 h-4" />
            {showPreview ? 'Hide' : 'Show'} Preview
          </button>
        </div>

        {showPreview && (
          <div className="border-2 border-gray-200 rounded-lg p-4 bg-gray-50">
            {isImage && (
              <img src={previewUrl} alt="Preview" className="max-w-full max-h-96 mx-auto rounded-lg shadow-md" />
            )}
            {isPdf && (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center p-8">
                    <div className="text-gray-500">Loading PDF preview...</div>
                  </div>
                }
              >
                <div>
                  <PdfPreview
                    file={file}
                    pageNumber={pageNumber}
                    onLoadSuccess={(totalPages) => setNumPages(totalPages)}
                  />
                  {numPages > 1 && (
                    <div className="flex items-center justify-center gap-4 p-4 bg-gray-50 border-t mt-2 rounded-b-lg">
                      <button
                        onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                        disabled={pageNumber <= 1}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-700">
                        Page {pageNumber} of {numPages}
                      </span>
                      <button
                        onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
                        disabled={pageNumber >= numPages}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </Suspense>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Document Upload</h1>
            <p className="text-gray-600">Upload your healthcare documents, medical records, or insurance information</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {uploadError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm font-semibold">Upload Error</p>
              <p className="text-red-600 text-sm mt-1">{uploadError}</p>
            </div>
          )}

          {uploadSuccess && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-700 text-sm font-semibold">✓ Upload Successful</p>
              <p className="text-green-600 text-sm mt-1">Your document has been uploaded successfully.</p>
              <p className="text-green-700 text-sm mt-3 font-medium">
                You can now return to the text message conversation and ask any questions about your uploaded document.
              </p>
            </div>
          )}

          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-xl p-12 transition-all ${
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileInputChange}
              accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
              className="hidden"
              id="file-input"
            />

            {!file ? (
              <div className="text-center">
                <Upload className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <label htmlFor="file-input" className="cursor-pointer inline-block">
                  <span className="text-blue-600 hover:text-blue-700 font-semibold">Click to upload</span>
                  <span className="text-gray-600"> or drag and drop</span>
                </label>
                <p className="text-sm text-gray-500 mt-2">
                  Supported formats: {ALLOWED_EXTENSIONS.join(', ').toUpperCase()}
                </p>
                <p className="text-xs text-gray-400 mt-1">Maximum file size: 10MB</p>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-white rounded-lg p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="w-10 h-10 text-blue-500" />
                  ) : (
                    <FileText className="w-10 h-10 text-red-500" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <button
                  onClick={handleRemoveFile}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  aria-label="Remove file"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            )}
          </div>

          {file && renderPreview()}

          {file && (
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleSubmit}
                disabled={isUploading || uploadSuccess}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isUploading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Uploading...
                  </>
                ) : uploadSuccess ? (
                  'Submitted'
                ) : (
                  'Submit Document'
                )}
              </button>
              <button
                onClick={handleRemoveFile}
                className="px-6 py-3 border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

=================================================================================================


import React from 'react';

import { FindCareData, Provider } from '../types/findcare';
import { getTranslations } from '../utils/i18n';

interface FindCareRendererProps {
  data: FindCareData;
  language?: string;
}

export const FindCareRenderer: React.FC<FindCareRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const agentData = data.data[0];
  const providers = agentData?.data?.providers || [];

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noProviderInfo}</p>
        </div>
      </div>
    );
  }

  const getNetworkBadgeColor = (network: string): string => {
    return network.toLowerCase().includes('in') ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800';
  };

  const formatPhone = (phone: string): string => {
    if (!phone || phone.length !== 10) {
      return phone;
    }
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  };

  // Sort providers by distance ascending (shortest to longest)
  const sortedProviders = [...providers].sort((a, b) => {
    const distA = a.distance ? parseFloat(a.distance.replace(' mi', '')) : Infinity;
    const distB = b.distance ? parseFloat(b.distance.replace(' mi', '')) : Infinity;
    return distA - distB;
  });

  // Calculate summary metrics
  const totalProviders = providers.length;

  // Calculate distance range
  const distances = providers
    .map((p) => p.distance)
    .filter((d) => d !== null)
    .map((d) => parseFloat(d?.replace(' mi', '') || '0'))
    .filter((d) => !isNaN(d));

  const minDistance = distances.length > 0 ? Math.min(...distances) : null;
  const maxDistance = distances.length > 0 ? Math.max(...distances) : null;

  const renderProviderCard = (provider: Provider, index: number) => {
    const isInNetwork = provider.network.toLowerCase().includes('in');

    return (
      <div
        key={`${provider.providerQueryParams.recordkey}-${index}`}
        className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-l-4"
        style={{ borderLeftColor: isInNetwork ? '#10B981' : '#F97316' }}
      >
        {/* Provider Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-1">{provider.name}</h3>
            <p className="text-sm text-gray-600 flex items-start">
              <svg className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              {provider.specialty}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getNetworkBadgeColor(provider.network)}`}>
            {provider.network}
          </span>
        </div>

        {/* Provider Details */}
        <div className="space-y-3">
          {/* Address */}
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-gray-700">{provider.address}</p>
              {provider.distance && (
                <p className="text-xs text-blue-600 font-medium mt-1">
                  <svg className="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {provider.distance} {translations.away}
                </p>
              )}
            </div>
          </div>

          {/* Phone */}
          <div className="flex items-center">
            <svg
              className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            <a href={`tel:${provider.phone}`} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              {formatPhone(provider.phone)}
            </a>
          </div>

          {/* Rating */}
          {(() => {
            const ratingNum = Number(provider.rating);
            const hasRating = provider.rating !== null && !isNaN(ratingNum) && ratingNum > 0;
            const reviewLabel =
              provider.rating_count == null
                ? null
                : typeof provider.rating_count === 'number'
                  ? `${provider.rating_count} ${translations.reviews}`
                  : String(provider.rating_count);
            return hasRating ? (
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <div className="flex items-center">
                  <span className="text-sm font-semibold text-gray-900">{ratingNum.toFixed(1)}</span>
                  {reviewLabel && <span className="text-sm text-gray-500 ml-1">({reviewLabel})</span>}
                </div>
              </div>
            ) : reviewLabel ? (
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="text-sm text-gray-500">{reviewLabel}</span>
              </div>
            ) : null;
          })()}

          {/* Cost */}
          {provider.cost && (
            <div className="flex items-center">
              <svg
                className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm font-semibold text-green-600">{provider.cost}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{agentData.header.title}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Summary Metrics */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Total Providers */}
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">{translations.totalProviders}</p>
                <p className="text-2xl font-bold text-gray-900">{totalProviders}</p>
              </div>
            </div>

            {/* Network Breakdown */}
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">{translations.status}</p>
                <p className="text-lg font-bold text-gray-900">
                  <span className="text-green-600">{translations.inNetworkLabel}</span>
                </p>
              </div>
            </div>

            {/* Distance Range */}
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">{translations.distanceRange}</p>
                <p className="text-lg font-bold text-gray-900">
                  {minDistance !== null && maxDistance !== null
                    ? minDistance === maxDistance
                      ? `${minDistance.toFixed(1)} mi`
                      : `${minDistance.toFixed(1)} - ${maxDistance.toFixed(1)} mi`
                    : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Provider Cards */}
        {providers.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedProviders.map((provider, index) => renderProviderCard(provider, index))}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">{translations.noProvidersFound}</h3>
            <p className="text-gray-600">{translations.tryAdjustingSearch}</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.providerNote}
          </p>
        </div>
      </footer>
    </div>
  );
};

======================================================================================================

import React, { useState } from 'react';
import jsPDF from 'jspdf';

import { IdCardData } from '../types/idcard';
import { getTranslations } from '../utils/i18n';

interface IdCardRendererProps {
  data: IdCardData;
  language?: string;
}

export const IdCardRenderer: React.FC<IdCardRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const [activeCard, setActiveCard] = useState<'front' | 'back'>('front');

  const agentData = data.data[0];

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noIdCardInfo}</p>
        </div>
      </div>
    );
  }

  const imageFront = agentData.image_b64_front;
  const imageBack = agentData.image_b64_back;

  const downloadAsPDF = async () => {
    try {
      const loadImage = (base64: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${base64}`;
        });
      };

      const frontImg = await loadImage(imageFront);
      const backImg = await loadImage(imageBack);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const maxWidth = pageWidth - (margin * 2);

      const frontAspectRatio = frontImg.width / frontImg.height;
      const frontWidth = maxWidth;
      const frontHeight = frontWidth / frontAspectRatio;

      const backAspectRatio = backImg.width / backImg.height;
      const backWidth = maxWidth;
      const backHeight = backWidth / backAspectRatio;

      let yPosition = margin;

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text(translations.front, margin, yPosition);
      yPosition += 8;

      pdf.addImage(
        `data:image/png;base64,${imageFront}`,
        'PNG',
        margin,
        yPosition,
        frontWidth,
        frontHeight
      );

      yPosition += frontHeight + 15;

      if (yPosition + backHeight > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
      }

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text(translations.back, margin, yPosition);
      yPosition += 8;

      pdf.addImage(
        `data:image/png;base64,${imageBack}`,
        'PNG',
        margin,
        yPosition,
        backWidth,
        backHeight
      );

      const memberName = agentData.member_name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Member';
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${memberName}_ID_Card_${timestamp}.pdf`;
      
      pdf.save(filename);
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full max-w-2xl mx-auto">
        <div className="bg-blue-600 px-4 sm:px-6 py-4">
          <h1 className="text-lg sm:text-xl font-semibold text-white">{translations.idCards}</h1>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            {agentData.member_name ? (
              <p className="text-sm sm:text-base font-medium text-gray-800">{agentData.member_name}</p>
            ) : (
              <div />
            )}
            <button
              onClick={downloadAsPDF}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 sm:px-4 py-2 rounded-full transition-colors touch-manipulation"
              aria-label="Download PDF"
            >
              <span className="text-sm sm:text-base font-medium">{translations.downloadPdf}</span>
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div className="flex justify-center mb-4">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 w-full sm:w-auto">
              <button
                onClick={() => setActiveCard('front')}
                className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-md text-sm font-medium transition-all touch-manipulation ${
                  activeCard === 'front'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 active:text-gray-900'
                }`}
                aria-label="Show front of card"
              >
                {translations.front}
              </button>
              <button
                onClick={() => setActiveCard('back')}
                className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-md text-sm font-medium transition-all touch-manipulation ${
                  activeCard === 'back'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 active:text-gray-900'
                }`}
                aria-label="Show back of card"
              >
                {translations.back}
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-white shadow-sm">
            {activeCard === 'front' && imageFront ? (
              <img
                src={`data:image/png;base64,${imageFront}`}
                alt="ID Card Front"
                className="w-full h-auto rounded-lg"
                loading="lazy"
              />
            ) : activeCard === 'back' && imageBack ? (
              <img
                src={`data:image/png;base64,${imageBack}`}
                alt="ID Card Back"
                className="w-full h-auto rounded-lg"
                loading="lazy"
              />
            ) : (
              <div className="text-center py-8 sm:py-12 text-gray-500">
                <svg
                  className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-sm sm:text-base">{translations.cardImageNotAvailable}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

===========================================================================================

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message = 'Loading...' }) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-gray-600 text-lg">{message}</p>
      </div>
    </div>
  );
};

==================================================================================================

import React from 'react';
import { FileQuestion } from 'lucide-react';

export const NoDataDisplay: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
        <FileQuestion className="w-16 h-16 text-blue-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-3">No Data Available</h2>
        <p className="text-gray-600 mb-4">
          We couldn&apos;t find any information to display. Please check the URL parameters and try again.
        </p>
        <div className="bg-blue-50 rounded-lg p-4 text-left">
          <p className="text-sm font-medium text-gray-700 mb-2">Expected URL format:</p>
          <code className="text-xs text-blue-700 break-all">?message_id=YOUR_MESSAGE_ID</code>
        </div>
      </div>
    </div>
  );
};

=================================================================================================

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';

pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([pdfWorkerSrc], { type: 'text/javascript' }));

interface PdfPreviewProps {
  file: File;
  pageNumber: number;
  onLoadSuccess: (numPages: number) => void;
}

export function PdfPreview({ file, pageNumber, onLoadSuccess }: PdfPreviewProps) {
  return (
    <div className="w-full rounded-lg shadow-md overflow-hidden bg-white">
      <Document
        file={file}
        onLoadSuccess={({ numPages }) => onLoadSuccess(numPages)}
        onLoadError={(error) => console.error('Error loading PDF:', error)}
        className="flex flex-col items-center"
        suspense={false}
      >
        <Page
          pageNumber={pageNumber}
          renderTextLayer={true}
          renderAnnotationLayer={true}
          className="max-w-full"
          width={600}
        />
      </Document>
    </div>
  );
}

=============================================================================================

import React from 'react';

import { PharmacyData } from '../types/pharmacy';
import { getTranslations } from '../utils/i18n';

interface PharmacyOrderDetailRendererProps {
  data: PharmacyData;
  language?: string;
}

export const PharmacyOrderDetailRenderer: React.FC<PharmacyOrderDetailRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const agentData = data.data[0];
  const orderDetail = agentData?.order_detail;

  if (!orderDetail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noOrderDetailsAvailable}</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: string) => {
    if (!amount || amount === '') {
      return 'N/A';
    }
    const numAmount = parseFloat(amount.replace(/[$,]/g, ''));
    if (isNaN(numAmount)) {
      return amount || 'N/A';
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numAmount);
  };

  const formatDOB = (dob: string) => {
    const date = new Date(dob);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const getStatusColor = (status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('delivered') || statusLower.includes('shipped')) {
      return 'text-blue-600';
    }
    if (statusLower.includes('cancelled')) {
      return 'text-red-600';
    }
    if (statusLower.includes('progress') || statusLower.includes('placed') || statusLower.includes('active')) {
      return 'text-blue-600';
    }
    return 'text-gray-700';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-blue-600 text-white px-4 sm:px-6 py-4 sm:py-5">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <div>
                <h1 className="text-base sm:text-lg font-semibold">
                  {orderDetail.member.full_name.toUpperCase()} ({translations.dob} {formatDOB(orderDetail.member.dob)})
                </h1>
              </div>
            </div>
          </div>

          {/* Table Header - Desktop Only */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-gray-50 border-b border-gray-200">
            <div className="col-span-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              {translations.prescription}
            </div>
            <div className="col-span-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              {translations.status}
            </div>
            <div className="col-span-4 text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1">
              {translations.prescriber}
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="col-span-2 text-xs font-semibold text-gray-600 uppercase tracking-wider text-right">
              {translations.totalCost}
            </div>
          </div>

          {/* Prescriptions */}
          {orderDetail.prescriptions.map((prescription) => (
            <div key={prescription.order_drug_detail_id}>
              {/* Desktop Layout */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-6 border-b border-gray-200">
                <div className="col-span-4">
                  <h3 className="font-semibold text-gray-900 mb-1">{prescription.drug_name}</h3>
                  <p className="text-sm text-gray-600">Rx: {prescription.rx_number}</p>
                  <p className="text-sm text-gray-600 font-medium">{prescription.days_supply}</p>
                </div>
                <div className="col-span-2">
                  <span className={`text-sm font-medium ${getStatusColor(prescription.status)}`}>
                    {prescription.status}
                  </span>
                </div>
                <div className="col-span-4">
                  <p className="text-sm text-gray-900">{prescription.prescriber_name}</p>
                </div>
                <div className="col-span-2 text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {prescription.total_cost ? formatCurrency(prescription.total_cost) : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden px-4 py-5 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">{prescription.drug_name}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 uppercase">{translations.status}</span>
                    <span className={`text-sm font-medium ${getStatusColor(prescription.status)}`}>
                      {prescription.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 uppercase">{translations.prescriber}</span>
                    <span className="text-sm text-gray-900">{prescription.prescriber_name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 uppercase">{translations.totalCost}</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {prescription.total_cost ? formatCurrency(prescription.total_cost) : 'N/A'}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-sm text-gray-600">Rx: {prescription.rx_number}</p>
                    <p className="text-sm text-gray-600 font-medium">{prescription.days_supply}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Financials */}
          <div className="px-4 sm:px-6">
            {/* Sales Tax */}
            {orderDetail.financials.sales_tax && (
              <div className="flex justify-between items-center py-4 border-b border-gray-200">
                <p className="text-sm text-gray-700">{translations.salesTax}</p>
                <p className="text-sm text-gray-900">{formatCurrency(orderDetail.financials.sales_tax)}</p>
              </div>
            )}

            {/* Shipping */}
            <div className="flex justify-between items-center py-4 border-b border-gray-200">
              <p className="text-sm text-gray-700">{translations.shipping}</p>
              <p className="text-sm text-gray-900">
                {orderDetail.financials.shipping === '' || orderDetail.financials.shipping === '$0.00'
                  ? translations.free
                  : formatCurrency(orderDetail.financials.shipping)}
              </p>
            </div>

            {/* Total Price */}
            {orderDetail.financials.total_price && (
              <div className="flex justify-between items-center py-4 border-b border-gray-200">
                <p className="text-sm font-bold text-gray-900">{translations.totalPrice}</p>
                <p className="text-sm font-bold text-gray-900">{formatCurrency(orderDetail.financials.total_price)}</p>
              </div>
            )}

            {/* Amount Plan Paid */}
            {orderDetail.financials.amount_plan_paid && (
              <div className="flex justify-between items-center py-4 border-b border-gray-200">
                <p className="text-sm text-gray-700">{translations.amountPlanPaid}</p>
                <p className="text-sm text-gray-900">{formatCurrency(orderDetail.financials.amount_plan_paid)}</p>
              </div>
            )}

            {/* Your Responsibility */}
            {orderDetail.financials.your_responsibility && (
              <div className="flex justify-between items-center py-4 border-b border-gray-200">
                <p className="text-sm font-bold text-gray-900">{translations.yourResponsibility}</p>
                <p className="text-sm font-bold text-gray-900">
                  {formatCurrency(orderDetail.financials.your_responsibility)}
                </p>
              </div>
            )}

            {/* Payment Method */}
            {orderDetail.financials.payment_method && orderDetail.financials.amount_paid && (
              <div className="flex justify-between items-center py-4 border-b border-gray-200">
                <p className="text-sm text-gray-700">{orderDetail.financials.payment_method}</p>
                <p className="text-sm text-gray-900">
                  {orderDetail.financials.amount_paid.startsWith('-')
                    ? orderDetail.financials.amount_paid
                    : `-${formatCurrency(orderDetail.financials.amount_paid)}`}
                </p>
              </div>
            )}

            {/* Remaining Balance */}
            <div className="flex justify-between items-center py-4 mb-4">
              <p className="text-sm font-bold text-gray-900">{translations.remainingBalance}</p>
              <p className="text-sm font-bold text-gray-900">
                {formatCurrency(orderDetail.financials.remaining_balance)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

===============================================================================================

import React, { useState } from 'react';

import { PharmacyData } from '../types/pharmacy';
import { getTranslations } from '../utils/i18n';

interface PharmacyOrdersRendererProps {
  data: PharmacyData;
  language?: string;
}

export const PharmacyOrdersRenderer: React.FC<PharmacyOrdersRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const agentData = data.data[0];
  const orders = agentData?.orders || [];
  const totalOrders = agentData?.total_orders || orders.length;
  const showViewAllMessage = agentData?.show_view_all_message;

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  const totalPages = Math.ceil(orders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentOrders = orders.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxPagesToShow = 7;

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis-end');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis-start');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('ellipsis-start');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis-end');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noPharmacyInfo}</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('shipped') || statusLower.includes('delivered')) {
      return 'bg-green-100 text-green-800';
    }
    if (statusLower.includes('cancelled')) {
      return 'bg-red-100 text-red-800';
    }
    if (statusLower.includes('progress') || statusLower.includes('placed')) {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('shipped') || statusLower.includes('delivered')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('cancelled')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('progress') || statusLower.includes('placed')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return null;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.pharmacyOrders}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {translations.found} {totalOrders}{' '}
              {totalOrders === 1 ? translations.foundOrder : translations.foundOrders}
            </h2>
            <span className="text-sm text-blue-600 font-medium">
              {translations.showing} {startIndex + 1}-{Math.min(endIndex, orders.length)} {translations.of}{' '}
              {orders.length}
            </span>
          </div>

          <div className="space-y-4">
            {orders.length === 0 ? (
              <div className="text-center py-12">
                <svg
                  className="w-16 h-16 text-gray-400 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <p className="text-gray-600">{translations.noOrdersFound}</p>
              </div>
            ) : (
              currentOrders.map((order) => (
                <div
                  key={order.order_id}
                  className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-lg text-gray-900">
                            {translations.orderEnding} {order.order_number_last4}
                          </h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {translations.orderedOn} {formatDate(order.order_date)}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusColor(order.status)}`}
                        >
                          {getStatusIcon(order.status)}
                          {order.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                        <div className="col-span-2">
                          <p className="text-xs text-gray-500 mb-1">{translations.medication}</p>
                          <p className="text-sm font-medium text-gray-900">{order.drug_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">{translations.member}</p>
                          <p className="text-sm font-medium text-gray-900">{order.member_name}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination Controls */}
          {orders.length > itemsPerPage && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`relative inline-flex items-center px-4 py-2 text-sm font-medium rounded-md ${
                    currentPage === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  {translations.previous}
                </button>
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`relative ml-3 inline-flex items-center px-4 py-2 text-sm font-medium rounded-md ${
                    currentPage === totalPages
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  {translations.next}
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    {translations.page} <span className="font-medium">{currentPage}</span> {translations.of}{' '}
                    <span className="font-medium">{totalPages}</span>
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 text-sm font-medium ${
                        currentPage === 1
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    {getPageNumbers().map((page) => {
                      if (typeof page === 'string') {
                        return (
                          <span
                            key={page}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                          >
                            ...
                          </span>
                        );
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            page === currentPage
                              ? 'z-10 bg-blue-600 border-blue-600 text-white'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {page}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 text-sm font-medium ${
                        currentPage === totalPages
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}

          {showViewAllMessage && orders.length < totalOrders && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      {translations.youHave} {totalOrders - orders.length}{' '}
                      {totalOrders - orders.length === 1 ? translations.moreOrder : translations.moreOrders}.{' '}
                      {translations.replyAll}
                      <strong>ALL</strong> {translations.toViewCompleteList}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

===========================================================================

import React from 'react';

import { PlanInfoData } from '../types/planInfo';
import { getTranslations } from '../utils/i18n';

interface PlanInfoRendererProps {
  data: PlanInfoData;
  language?: string;
}

export const PlanInfoRenderer: React.FC<PlanInfoRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);

  const planPage = data.data.find((item) => item.plan_page)?.plan_page;

  if (!planPage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noPlanInfo}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-2xl mx-auto py-4 sm:py-6 px-4">
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-4 sm:px-6 py-4">
            <h1 className="text-lg sm:text-xl font-semibold text-white">{translations.planInformation}</h1>
          </div>

          <div className="px-4 sm:px-6 py-4 sm:py-6">
            {planPage.header && (
              <p className="text-sm sm:text-base font-medium text-gray-800 mb-4">{planPage.header}</p>
            )}

            {planPage.details && planPage.details.length > 0 && (
              <dl className="border border-gray-200 rounded-lg divide-y divide-gray-200 mb-4">
                {planPage.details.map((detail) => (
                  <div
                    key={detail.label}
                    className="px-3 sm:px-4 py-2 sm:py-3 flex flex-col sm:flex-row sm:justify-between sm:items-center"
                  >
                    <dt className="text-sm font-medium text-gray-600">{detail.label}</dt>
                    <dd className="text-sm sm:text-base text-gray-900 sm:text-right">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {planPage.notes && planPage.notes.length > 0 && (
              <div className="space-y-3 mb-4">
                {planPage.notes.map((note) => (
                  <p key={note} className="text-sm text-gray-600">
                    {note}
                  </p>
                ))}
              </div>
            )}

            {planPage.life_events_url && (
              <a
                href={planPage.life_events_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm sm:text-base text-blue-600 hover:text-blue-800 underline"
              >
                {planPage.life_events_label || planPage.life_events_url}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

===================================================================================

import React from 'react';

import { PriorAuthData } from '../types/priorAuth';
import { getTranslations } from '../utils/i18n';

interface PriorAuthListRendererProps {
  data: PriorAuthData;
  language?: string;
}

export const PriorAuthListRenderer: React.FC<PriorAuthListRendererProps> = ({ data, language }) => {
  const translations = getTranslations(language);
  const agentData = data.data[0];
  const authorizations = agentData?.authorizations || [];
  const totalCount = agentData?.total_count || authorizations.length;
  const showViewAllMessage = agentData?.show_view_all_message;
  const dateRange = agentData?.date_range;
  const highlightedAuthId = agentData?.highlighted_auth_id;

  if (!agentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">{translations.noPriorAuthInfo}</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('approved')) {
      return 'bg-green-100 text-green-800';
    }
    if (statusLower.includes('denied')) {
      return 'bg-red-100 text-red-800';
    }
    if (statusLower.includes('pended') || statusLower.includes('pending')) {
      return 'bg-yellow-100 text-yellow-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('approved')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('denied')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    if (statusLower.includes('pended') || statusLower.includes('pending')) {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    );
  };

  const formatDate = (dateString: string) => {
    if (!dateString) {
      return 'N/A';
    }
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const sortedAuthorizations = [...authorizations].sort((a, b) => {
    return new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{translations.priorAuthorizations}</h1>
            {dateRange && (
              <p className="text-blue-100 text-sm mt-2">
                {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {translations.found} {totalCount}{' '}
              {totalCount === 1 ? translations.foundAuthorization : translations.foundAuthorizations}
            </h2>
            {showViewAllMessage && (
              <span className="text-sm text-blue-600 font-medium">
                {translations.showing} {authorizations.length} {translations.of} {totalCount}
              </span>
            )}
          </div>

          <div className="space-y-4">
            {sortedAuthorizations.length === 0 ? (
              <div className="text-center py-12">
                <svg
                  className="w-16 h-16 text-gray-400 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-600">{translations.noPriorAuthsFound}</p>
              </div>
            ) : (
              sortedAuthorizations.map((auth) => {
                const isHighlighted = highlightedAuthId && auth.reference_number === highlightedAuthId;

                return (
                  <div
                    key={auth.reference_number}
                    className={`border rounded-lg p-5 transition-all ${
                      isHighlighted
                        ? 'border-blue-500 bg-blue-50 shadow-lg ring-2 ring-blue-200'
                        : 'border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
                              {auth.reference_number}
                              {isHighlighted && (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                  </svg>
                                  {translations.highlighted}
                                </span>
                              )}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {translations.processedOn} {auth.processed_date}
                            </p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusColor(auth.status)}`}
                          >
                            {getStatusIcon(auth.status)}
                            {auth.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">{translations.serviceRequested}</p>
                            <p className="text-sm font-medium text-gray-900">{auth.service_requested}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">{translations.requestedBy}</p>
                            <p className="text-sm font-medium text-gray-900">{auth.requested_by}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">{translations.lastUpdated}</p>
                            <p className="text-sm font-medium text-gray-900">{formatDate(auth.last_updated)}</p>
                          </div>
                        </div>

                        {auth.status_reason && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">{translations.statusReason}</p>
                            <p className="text-sm text-gray-900">{auth.status_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {showViewAllMessage && authorizations.length < totalCount && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      {translations.youHave} {totalCount - authorizations.length}{' '}
                      {totalCount - authorizations.length === 1
                        ? translations.moreAuthorization
                        : translations.moreAuthorizations}
                      . {translations.replyAll} <strong>ALL</strong> {translations.toViewCompleteList}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            {translations.noPriorAuthInfo}
          </p>
        </div>
      </footer>
    </div>
  );
};

==========================================================================

#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.checkmarx.env"
SETUP_SCRIPT="${SCRIPT_DIR}/setup-api-key.sh"

INCREMENTAL=false
if [[ "$1" == "-i" ]]; then
    INCREMENTAL=true
fi

echo "🔍 Checkmarx Security Scan"
echo "=========================="
echo ""

if ! command -v cx &> /dev/null; then
    echo "❌ Checkmarx CLI not found"
    echo ""
    echo "Installing Checkmarx CLI..."
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        DOWNLOAD_URL="https://github.com/Checkmarx/ast-cli/releases/latest/download/ast-cli_darwin_x64.tar.gz"
        INSTALL_DIR="/usr/local/bin"
        ARCHIVE_EXT="tar.gz"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        DOWNLOAD_URL="https://github.com/Checkmarx/ast-cli/releases/latest/download/ast-cli_linux_x64.tar.gz"
        INSTALL_DIR="/usr/local/bin"
        ARCHIVE_EXT="tar.gz"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        DOWNLOAD_URL="https://github.com/Checkmarx/ast-cli/releases/latest/download/ast-cli_windows_x64.zip"
        INSTALL_DIR="$HOME/bin"
        ARCHIVE_EXT="zip"
        echo "⚠️  Windows detected - CLI will be installed to $INSTALL_DIR"
        echo "   Make sure $INSTALL_DIR is in your PATH"
    else
        echo "❌ Unsupported OS: $OSTYPE"
        echo "   Please download manually from: https://github.com/Checkmarx/ast-cli/releases"
        exit 1
    fi

    TMP_DIR=$(mktemp -d)
    echo "📥 Downloading from: $DOWNLOAD_URL"

    if [[ "$ARCHIVE_EXT" == "tar.gz" ]]; then
        curl -L -o "${TMP_DIR}/cx.tar.gz" "$DOWNLOAD_URL"
        echo "📦 Extracting..."
        tar -xzf "${TMP_DIR}/cx.tar.gz" -C "$TMP_DIR"

        echo "🔧 Installing to $INSTALL_DIR/cx (requires sudo)..."
        sudo mkdir -p "$INSTALL_DIR"
        sudo mv "${TMP_DIR}/cx" "$INSTALL_DIR/cx"
        sudo chmod +x "$INSTALL_DIR/cx"
    else
        curl -L -o "${TMP_DIR}/cx.zip" "$DOWNLOAD_URL"
        echo "📦 Extracting..."
        unzip -q "${TMP_DIR}/cx.zip" -d "$TMP_DIR"

        echo "🔧 Installing to $INSTALL_DIR/cx.exe..."
        mkdir -p "$INSTALL_DIR"
        mv "${TMP_DIR}/cx.exe" "$INSTALL_DIR/cx.exe"
        chmod +x "$INSTALL_DIR/cx.exe"
    fi

    rm -rf "$TMP_DIR"

    echo "✅ Checkmarx CLI installed successfully"
    echo ""
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "⚠️  API key not configured"
    echo ""
    echo "Running automated setup..."
    echo ""

    if [[ ! -f "$SETUP_SCRIPT" ]]; then
        echo "❌ Setup script not found: $SETUP_SCRIPT"
        exit 1
    fi

    bash "$SETUP_SCRIPT"

    if [[ ! -f "$ENV_FILE" ]]; then
        echo "❌ Setup failed - .checkmarx.env not created"
        exit 1
    fi

    echo ""
    echo "✅ Setup complete!"
    echo ""
fi

echo "🔑 Loading credentials..."
source "$ENV_FILE"

if [[ -z "$CX_APIKEY" ]]; then
    echo "❌ CX_APIKEY environment variable not set in .checkmarx.env"
    exit 1
fi

if [[ -z "$CX_BASE_URI" ]]; then
    echo "❌ CX_BASE_URI environment variable not set in .checkmarx.env"
    exit 1
fi

echo "✅ Credentials loaded"
echo ""

echo "🔐 Testing authentication..."
if ! cx auth validate; then
    echo ""
    echo "❌ Authentication failed"
    echo ""
    echo "Your API key may be expired or invalid."
    echo "Run: ./tools/checkmarx/setup-api-key.sh to regenerate"
    exit 1
fi
echo "✅ Authentication successful"
echo ""

generate_ai_suggestions() {
    local report="$1"
    local output="$2"
    local critical="$3"
    local high="$4"
    local medium="$5"
    local low="$6"

    local scan_date
    scan_date=$(date "+%Y-%m-%d %H:%M:%S")

    cat > "$output" << HEADER
# AI Security Fix Suggestions
**Project:** Digital Twin React-policy
**Scan date:** ${scan_date}
**Report:** $(basename "$report")

## Summary
| Severity | Count | Action |
|----------|-------|--------|
| 🔴 CRITICAL | ${critical} | Fix before PR |
| 🟠 HIGH | ${high} | Fix before PR |
| 🟡 MEDIUM | ${medium} | Fix before merge |
| 🟢 LOW | ${low} | Address in backlog |

---
HEADER

    for severity in CRITICAL HIGH MEDIUM LOW; do
        local findings
        findings=$(jq -r --arg sev "$severity" '
            .results[]
            | select(.severity == $sev)
            | "### \(.queryName // "Unknown")\n" +
              "- **File:** `\(.fileName // "N/A")`  **Line:** \(.line // "N/A")\n" +
              "- **Description:** \(.description // "No description available")\n" +
              "- **CWE:** \(.cweId // "N/A")\n"
        ' "$report" 2>/dev/null)

        if [[ -n "$findings" ]]; then
            local icon
            case "$severity" in
                CRITICAL) icon="🔴" ;;
                HIGH)     icon="🟠" ;;
                MEDIUM)   icon="🟡" ;;
                LOW)      icon="🟢" ;;
            esac

            echo "" >> "$output"
            echo "## ${icon} ${severity} Severity" >> "$output"
            echo "" >> "$output"

            local query_names
            query_names=$(jq -r --arg sev "$severity" '[.results[] | select(.severity == $sev) | .queryName] | unique[]' "$report" 2>/dev/null)

            while IFS= read -r query; do
                [[ -z "$query" ]] && continue

                local files
                files=$(jq -r --arg sev "$severity" --arg q "$query" '
                    [.results[] | select(.severity == $sev and .queryName == $q) | "\(.fileName // "N/A"):\(.line // "?")"]
                    | unique | .[]
                ' "$report" 2>/dev/null | head -5)

                local description
                description=$(jq -r --arg sev "$severity" --arg q "$query" '
                    [.results[] | select(.severity == $sev and .queryName == $q) | .description] | first // "No description"
                ' "$report" 2>/dev/null)

                local cwe
                cwe=$(jq -r --arg sev "$severity" --arg q "$query" '
                    [.results[] | select(.severity == $sev and .queryName == $q) | .cweId // "N/A"] | first
                ' "$report" 2>/dev/null)

                echo "### $query" >> "$output"
                echo "" >> "$output"
                echo "**CWE:** $cwe" >> "$output"
                echo "" >> "$output"
                echo "**Description:** $description" >> "$output"
                echo "" >> "$output"
                echo "**Affected files:**" >> "$output"
                while IFS= read -r f; do
                    [[ -n "$f" ]] && echo "- \`$f\`" >> "$output"
                done <<< "$files"
                echo "" >> "$output"
                echo "**AI Suggested Fix:**" >> "$output"
                echo "" >> "$output"

                case "$query" in
                    *SQL_Injection*|*SQLi*)
                        echo "- Use parameterized queries or an ORM instead of string concatenation." >> "$output"
                        echo "- Never interpolate user input directly into SQL strings." >> "$output"
                        echo "- Apply input validation and allowlisting on all user-supplied values." >> "$output"
                        ;;
                    *XSS*|*Cross_Site*)
                        echo "- Escape all user-supplied output using a trusted library." >> "$output"
                        echo "- Set \`Content-Security-Policy\` headers to restrict script execution." >> "$output"
                        echo "- Use framework templating engines that auto-escape by default." >> "$output"
                        ;;
                    *Path_Traversal*|*Directory_Traversal*)
                        echo "- Resolve and validate file paths before use." >> "$output"
                        echo "- Restrict file access to an explicit allowlist of safe directories." >> "$output"
                        echo "- Reject paths containing \`../\` or absolute path components from user input." >> "$output"
                        ;;
                    *Command_Injection*|*OS_Command*)
                        echo "- Replace shell calls with native library equivalents where possible." >> "$output"
                        echo "- Validate and sanitize all user-controlled values before passing to subprocesses." >> "$output"
                        ;;
                    *Hardcoded*Password*|*Hardcoded*Secret*|*Hardcoded*Key*)
                        echo "- Remove hardcoded secrets immediately and rotate any exposed credentials." >> "$output"
                        echo "- Load secrets from environment variables or a secrets manager." >> "$output"
                        echo "- Add a pre-commit hook (e.g. \`detect-secrets\`) to prevent future occurrences." >> "$output"
                        ;;
                    *Insecure_Deserialization*)
                        echo "- Avoid deserializing untrusted data." >> "$output"
                        echo "- Validate and schema-check all deserialized objects before use." >> "$output"
                        ;;
                    *Open_Redirect*)
                        echo "- Validate redirect URLs against an explicit allowlist of trusted domains." >> "$output"
                        echo "- Avoid using unvalidated user input to construct redirect targets." >> "$output"
                        ;;
                    *SSRF*)
                        echo "- Validate and allowlist all URLs before making outbound requests." >> "$output"
                        echo "- Block requests to internal/private IP ranges (169.254.x.x, 10.x.x.x, etc.)." >> "$output"
                        echo "- Use a dedicated HTTP client with timeouts and redirect limits." >> "$output"
                        ;;
                    *Insecure_Random*|*Weak_Random*)
                        echo "- Use cryptographically secure random number generation for security-sensitive operations." >> "$output"
                        ;;
                    *Log_Injection*|*Log_Forging*)
                        echo "- Sanitize user input before writing to logs — strip or encode newline characters." >> "$output"
                        echo "- Use structured logging to avoid string interpolation in log messages." >> "$output"
                        ;;
                    *)
                        echo "- Review the flagged code and apply the principle of least privilege." >> "$output"
                        echo "- Validate and sanitize all external inputs before use." >> "$output"
                        echo "- Consult OWASP guidelines for CWE-${cwe}: https://owasp.org/www-community/vulnerabilities/" >> "$output"
                        echo "- Reference Checkmarx portal for full remediation details:" >> "$output"
                        echo "  https://elegance.cxone.cloud/projects/0eab7a42-95d6-4468-8f47-ee6621de6454/overview" >> "$output"
                        ;;
                esac

                echo "" >> "$output"
                echo "---" >> "$output"
                echo "" >> "$output"
            done <<< "$query_names"
        fi
    done

    echo "## Next Steps" >> "$output"
    echo "" >> "$output"
    echo "1. Address all **CRITICAL** and **HIGH** findings before creating a PR." >> "$output"
    echo "2. Run an incremental re-scan after fixes: \`./tools/checkmarx/scan.sh -i\`" >> "$output"
    echo "3. Verify no new issues were introduced." >> "$output"
    echo "4. View full results: https://elegance.cxone.cloud/projects/0eab7a42-95d6-4468-8f47-ee6621de6454/overview" >> "$output"
}

BRANCH=$(git rev-parse --abbrev-ref HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="${REPO_ROOT}/checkmarx-report-${TIMESTAMP}"
REPORT_FILE="${REPORT_DIR}/cx_result.json"

echo "📊 Scan Configuration"
echo "  Branch: $BRANCH"
echo "  Type: $([ "$INCREMENTAL" = true ] && echo "Incremental" || echo "Full")"
echo "  Report dir: $(basename "$REPORT_DIR")"
echo ""

SCAN_ARGS=(
    "scan" "create"
    "--project-name" "Digital Twin React-policy"
    "--branch" "$BRANCH"
    "-s" "$REPO_ROOT"
    "--report-format" "json"
    "--output-path" "$REPORT_DIR"
)

if [ "$INCREMENTAL" = true ]; then
    SCAN_ARGS+=("--incremental")
fi

echo "🚀 Starting scan..."
echo ""

if cx "${SCAN_ARGS[@]}"; then
    echo ""
    echo "✅ Scan completed successfully"
    echo ""

    if [[ -f "$REPORT_FILE" ]]; then
        echo "📄 Report generated: $REPORT_FILE"
        echo "📁 Report directory: $REPORT_DIR"
        echo ""

        if command -v jq &> /dev/null; then
            echo "📊 Results Summary:"
            echo ""

            CRITICAL=$(jq '[.results[] | select(.severity == "CRITICAL")] | length' "$REPORT_FILE" 2>/dev/null || echo "0")
            HIGH=$(jq '[.results[] | select(.severity == "HIGH")] | length' "$REPORT_FILE" 2>/dev/null || echo "0")
            MEDIUM=$(jq '[.results[] | select(.severity == "MEDIUM")] | length' "$REPORT_FILE" 2>/dev/null || echo "0")
            LOW=$(jq '[.results[] | select(.severity == "LOW")] | length' "$REPORT_FILE" 2>/dev/null || echo "0")

            echo "  🔴 CRITICAL: $CRITICAL"
            echo "  🟠 HIGH:     $HIGH"
            echo "  🟡 MEDIUM:   $MEDIUM"
            echo "  🟢 LOW:      $LOW"
            echo ""

            if [[ "$CRITICAL" -gt 0 ]] || [[ "$HIGH" -gt 0 ]]; then
                echo "⚠️  Action required: Fix CRITICAL and HIGH severity issues before PR"
            else
                echo "✅ No CRITICAL or HIGH severity issues found"
            fi

            TOTAL=$((CRITICAL + HIGH + MEDIUM + LOW))
            if [[ "$TOTAL" -gt 0 ]]; then
                echo ""
                echo "🤖 Generating AI fix suggestions..."
                SUGGESTIONS_FILE="${REPO_ROOT}/checkmarx-suggestions-${TIMESTAMP}.md"
                generate_ai_suggestions "$REPORT_FILE" "$SUGGESTIONS_FILE" "$CRITICAL" "$HIGH" "$MEDIUM" "$LOW"
                echo "✅ AI suggestions written to: $(basename "$SUGGESTIONS_FILE")"
            fi
        else
            echo "💡 Install jq for detailed results summary:"
            echo "   - Download from: https://jqlang.github.io/jq/download/"
            echo "   - Or view full results in Checkmarx portal"
        fi
    fi

    echo ""
    echo "🌐 View full results:"
    echo "  https://elegance.cxone.cloud/projects/0eab7a42-95d6-4468-8f47-ee6621de6454/overview"
    echo ""
else
    echo ""
    echo "❌ Scan failed"
    echo ""
    echo "Check the error messages above for details."
    echo "Common issues:"
    echo "  - Network connectivity"
    echo "  - Invalid project name"
    echo "  - Insufficient permissions"
    echo ""
    exit 1
fi

==========================================================================================================

---
description: Run Checkmarx security scans
---

# Checkmarx Security Scan Workflow

## Prerequisites

- Access to https://elegance.cxone.cloud
- Valid Checkmarx API key (generated during first run)

## Quick Start

### First Time Setup + Full Scan

```bash
./tools/checkmarx/scan.sh
```

**What happens:**

1. Checks if Checkmarx CLI is installed
2. If not installed: downloads and installs to `/usr/local/bin/cx` (requires sudo)
3. Checks for API key in `.checkmarx.env`
4. If missing: launches `./tools/checkmarx/setup-api-key.sh` automatically
5. Opens browser to https://elegance.cxone.cloud for API key generation
6. Prompts you to paste API key
7. Creates `.checkmarx.env` with secure permissions (600)
8. Tests authentication
9. Runs full security scan on current branch
10. Displays results by severity (CRITICAL, HIGH, MEDIUM, LOW)
11. Generates JSON report

**Expected time:** 5-15 minutes for full scan

### Incremental Scan (After Fixes)

```bash
./tools/checkmarx/scan.sh -i
```

Scans only changed files since last scan.

**Expected time:** 2-5 minutes

## Manual API Key Setup

If automatic setup fails or you need to regenerate:

```bash
./tools/checkmarx/setup-api-key.sh
```

**Steps:**

1. Script opens https://elegance.cxone.cloud
2. Log in with your credentials
3. Navigate to: **Settings → Access Management → API Keys**
4. Click **"Generate New API Key"**
5. Copy the generated key
6. Return to terminal and paste when prompted
7. Script validates the key
8. Creates `.checkmarx.env` file

## Scan Workflow for PR

### 1. Before Creating PR

// turbo

```bash
./tools/checkmarx/scan.sh
```

### 2. Review Results

Check console output for issues by severity:

- **CRITICAL**: Must fix before PR
- **HIGH**: Must fix before PR
- **MEDIUM**: Should fix before merge
- **LOW**: Can be addressed later

### 3. Generate Impact Analysis

**Before fixing any issues**, analyze the scope of required changes:

```bash
# Review the JSON report
cat checkmarx-report-*.json | jq '.results[] | {severity, fileName, queryName, description}'
```

**Key questions to answer:**

1. **Dependency Updates Required?**
   - Do fixes require updating Node.js or npm package versions?
   - Are there breaking changes in dependencies?

2. **Infrastructure Impact?**
   - Will changes require pipeline updates?
   - Are there deployment configuration changes needed?

3. **Code Scope?**
   - How many files are affected?
   - Are changes isolated or cross-cutting?
   - Do changes affect public APIs or components?

4. **Testing Impact?**
   - What test coverage is needed?
   - Are integration tests affected?
   - Do we need to update test environments?

**Document findings** in a comment or ticket before proceeding.

### 4. Fix Issues

After impact analysis, address security findings:

- Start with CRITICAL and HIGH severity issues
- Follow the documented impact analysis plan
- Update infrastructure/pipeline configs if needed

### 5. Re-scan After Fixes

// turbo

```bash
./tools/checkmarx/scan.sh -i
```

### 6. Verify Clean Scan

Ensure CRITICAL and HIGH severity issues are resolved.

### 7. Create PR

Once scan is clean, proceed with PR creation.

## Troubleshooting

### "CX_APIKEY environment variable not set"

**Solution:** Script automatically runs setup. Follow the prompts.

### "Authentication failed"

**Solution:**

```bash
./tools/checkmarx/setup-api-key.sh
```

Regenerate API key and paste new one.

### "Permission denied" during CLI install

**Solution:** Enter sudo password when prompted. CLI must be installed to `/usr/local/bin`.

### API Key Expired

**Solution:**

```bash
./tools/checkmarx/setup-api-key.sh
```

Generate new key at https://elegance.cxone.cloud

### Scan Stuck or Timeout

**Solution:**

1. Check scan status in Checkmarx portal
2. Cancel stuck scan if needed
3. Re-run: `./tools/checkmarx/scan.sh`

## Project Information

- **Project Name:** Digital Twin React-policy
- **Project ID:** 0eab7a42-95d6-4468-8f47-ee6621de6454
- **Portal:** https://elegance.cxone.cloud
- **Direct Link:** https://elegance.cxone.cloud/projects/0eab7a42-95d6-4468-8f47-ee6621de6454/overview

## Files Created

| File                         | Purpose            | Git Status                 |
| ---------------------------- | ------------------ | -------------------------- |
| `.checkmarx.env`             | API key storage    | **Ignored** (never commit) |
| `checkmarx-report-*.json`    | Scan results       | **Ignored**                |
| `checkmarx-suggestions-*.md` | AI fix suggestions | **Ignored**                |
| `~/.checkmarx/cx.config`     | CLI config         | Outside repo               |

## Security Notes

- ✅ `.checkmarx.env` is in `.gitignore` - never committed
- ✅ File permissions set to 600 (owner read/write only)
- ✅ Each developer needs their own API key
- ✅ API keys should be rotated periodically
- ⚠️ Never share API keys via Slack, email, or commit to git

## Additional Commands

### View Scan History

Visit: https://elegance.cxone.cloud/projects/0eab7a42-95d6-4468-8f47-ee6621de6454/scans

### Check CLI Version

```bash
cx version
```

### Test Authentication

```bash
source .checkmarx.env
cx auth validate
```

## Related Documentation

- Checkmarx CLI docs: https://checkmarx.com/resource/documents/en/34965-68621-cli.html

==============================================================================================

#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.checkmarx.env"

echo "🔧 Checkmarx API Key Setup"
echo "=========================="
echo ""

if [[ -f "$ENV_FILE" ]]; then
    echo "⚠️  Existing .checkmarx.env found"
    echo ""
    read -p "Do you want to regenerate the API key? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled"
        exit 0
    fi
    echo ""
fi

echo "📖 Instructions:"
echo ""
echo "1. Opening Checkmarx portal in your browser..."
echo "2. Log in with your credentials"
echo "3. Navigate to: Settings → Access Management → API Keys"
echo "4. Click 'Generate New API Key'"
echo "5. Copy the generated key"
echo "6. Return here and paste it when prompted"
echo ""

sleep 2

if command -v open &> /dev/null; then
    open "https://elegance.cxone.cloud"
elif command -v xdg-open &> /dev/null; then
    xdg-open "https://elegance.cxone.cloud"
else
    echo "🌐 Please open: https://elegance.cxone.cloud"
fi

echo ""
read -p "Press Enter when you're ready to paste your API key..."
echo ""

read -sp "🔑 Paste your Checkmarx API key: " API_KEY
echo ""
echo ""

if [[ -z "$API_KEY" ]]; then
    echo "❌ No API key provided"
    exit 1
fi

API_KEY=$(echo "$API_KEY" | xargs)

echo "💾 Creating .checkmarx.env..."

cat > "$ENV_FILE" << EOF
export CX_APIKEY='${API_KEY}'
export CX_BASE_URI='https://elegance.cxone.cloud'
EOF

chmod 600 "$ENV_FILE"

echo "✅ .checkmarx.env created with secure permissions (600)"
echo ""

echo "🔐 Testing authentication..."
source "$ENV_FILE"

if command -v cx &> /dev/null; then
    if cx auth validate; then
        echo ""
        echo "✅ Authentication successful!"
        echo ""
        echo "🎉 Setup complete!"
        echo ""
        echo "Next steps:"
        echo "  1. Run a scan: ./tools/checkmarx/scan.sh"
        echo "  2. View results in console or JSON report"
        echo "  3. Fix any CRITICAL/HIGH severity issues"
        echo ""
    else
        echo ""
        echo "❌ Authentication failed"
        echo ""
        echo "Please verify:"
        echo "  - API key was copied correctly"
        echo "  - API key has not expired"
        echo "  - You have access to the Checkmarx project"
        echo ""
        echo "To try again, run: ./tools/checkmarx/setup-api-key.sh"
        exit 1
    fi
else
    echo "⚠️  Checkmarx CLI not installed yet"
    echo ""
    echo "Run ./tools/checkmarx/scan.sh to install CLI and run first scan"
    echo ""
fi

echo "📝 Security reminder:"
echo "  - .checkmarx.env is in .gitignore (never commit it)"
echo "  - Each developer needs their own API key"
echo "  - Rotate API keys periodically"
echo ""

=====================================================================================

