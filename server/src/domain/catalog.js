/** Portafolio base (plantilla) que se carga al crear un laboratorio. Precios en COP: valores de EJEMPLO, cada laboratorio los ajusta. */
export const SPECIES = ['canino', 'felino', 'equino', 'bovino', 'ovino', 'caprino', 'porcino', 'aviar', 'otro'];
export const SAMPLE_TYPES = ['sangre EDTA', 'sangre sin anticoagulante', 'suero', 'plasma', 'orina', 'heces', 'piel / raspado', 'biopsia', 'hisopado', 'líquido cavitario', 'otro'];
export const STATUSES = ['enviada', 'recibida', 'en_proceso', 'finalizada', 'rechazada', 'cancelada'];
export const NEXT = { enviada: ['recibida', 'rechazada'], recibida: ['en_proceso', 'finalizada', 'rechazada'], en_proceso: ['finalizada', 'rechazada'], finalizada: [], rechazada: [], cancelada: [] };

export const DEFAULT_PORTFOLIO = [
  ['HEM-01', 'Hemograma completo', 'Hematología', 'sangre EDTA', 24, 25000],
  ['HEM-02', 'Frotis sanguíneo / extendido', 'Hematología', 'sangre EDTA', 24, 15000],
  ['HEM-03', 'Hemoparásitos (gota gruesa)', 'Hematología', 'sangre EDTA', 24, 20000],
  ['HEM-04', 'Hematocrito y proteínas totales', 'Hematología', 'sangre EDTA', 24, 10000],
  ['QS-01', 'Creatinina', 'Química sanguínea', 'suero', 24, 15000],
  ['QS-02', 'BUN / Urea', 'Química sanguínea', 'suero', 24, 15000],
  ['QS-03', 'ALT (TGP)', 'Química sanguínea', 'suero', 24, 15000],
  ['QS-04', 'AST (TGO)', 'Química sanguínea', 'suero', 24, 15000],
  ['QS-05', 'Fosfatasa alcalina', 'Química sanguínea', 'suero', 24, 15000],
  ['QS-06', 'Glucosa', 'Química sanguínea', 'suero', 24, 10000],
  ['QS-07', 'Proteínas totales y albúmina', 'Química sanguínea', 'suero', 24, 18000],
  ['QS-08', 'Perfil renal (creatinina + BUN)', 'Perfiles', 'suero', 24, 28000],
  ['QS-09', 'Perfil hepático (ALT, AST, FA)', 'Perfiles', 'suero', 24, 40000],
  ['UR-01', 'Uroanálisis completo', 'Urianálisis', 'orina', 24, 20000],
  ['UR-02', 'Relación proteína/creatinina urinaria', 'Urianálisis', 'orina', 48, 35000],
  ['CO-01', 'Coprológico', 'Parasitología', 'heces', 24, 15000],
  ['CO-02', 'Coprológico por flotación', 'Parasitología', 'heces', 24, 15000],
  ['MI-01', 'Raspado cutáneo (ácaros)', 'Dermatología', 'piel / raspado', 24, 20000],
  ['MI-02', 'Citología de piel', 'Dermatología', 'piel / raspado', 48, 30000],
  ['MI-03', 'Cultivo de hongos (dermatofitos)', 'Dermatología', 'piel / raspado', 336, 45000],
  ['AG-01', 'Antibiograma con cultivo', 'Microbiología', 'hisopado', 96, 70000],
  ['HI-01', 'Histopatología (biopsia)', 'Patología', 'biopsia', 120, 90000],
  ['IN-01', 'Prueba rápida Parvovirus', 'Pruebas rápidas', 'heces', 2, 55000],
  ['IN-02', 'Prueba rápida Moquillo', 'Pruebas rápidas', 'hisopado', 2, 60000],
  ['IN-03', 'Prueba rápida Leucemia/Inmunodeficiencia felina', 'Pruebas rápidas', 'sangre sin anticoagulante', 2, 80000],
  ['EQ-01', 'Anemia infecciosa equina (AIE)', 'Equinos', 'suero', 72, 45000],
];
