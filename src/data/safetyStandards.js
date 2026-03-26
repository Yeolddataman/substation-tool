// UK Published Electrical Safety Standards & Regulations
// Used as context for AI chatbot and safety reference panel

export const safetyStandards = [
  {
    id: 'EaWR1989',
    title: 'Electricity at Work Regulations 1989',
    shortTitle: 'EaWR 1989',
    type: 'Legislation',
    authority: 'UK Parliament / HSE',
    year: 1989,
    status: 'In Force',
    scope: 'All electrical work in Great Britain',
    summary: 'The primary legislation governing electrical safety at work. Imposes duties on employers, employees and self-employed to prevent danger from electrical systems.',
    keyRequirements: [
      'Regulation 4: All electrical systems shall be of adequate construction and maintained to prevent danger',
      'Regulation 5: No electrical equipment shall be used where its strength or capability may be exceeded',
      'Regulation 11: Means shall be available to cut off supply and isolate electrical equipment',
      'Regulation 12: Precautions must be taken against electrical equipment becoming live',
      'Regulation 13: Adequate precautions must be taken before work on live conductors',
      'Regulation 14: No person shall work on live conductors unless it is unreasonable to dead them',
      'Regulation 16: Persons must be competent to prevent danger',
    ],
    relatedDocs: ['HSR25 — Memorandum of Guidance on EaWR', 'HSG85 — Electricity at work: Safe working practices'],
    url: 'https://www.legislation.gov.uk/uksi/1989/635',
    tags: ['legislation', 'live working', 'isolation', 'competence', 'substations'],
  },
  {
    id: 'BSEN50110',
    title: 'BS EN 50110-1:2013 — Operation of Electrical Installations',
    shortTitle: 'BS EN 50110-1',
    type: 'British Standard',
    authority: 'BSI / CENELEC',
    year: 2013,
    status: 'Current',
    scope: 'Operation, maintenance and switching of electrical installations',
    summary: 'Defines safety requirements for the operation of electrical installations. Covers working on, with or near electrical systems including HV and EHV.',
    keyRequirements: [
      'Defines five safety rules for electrical working (dead working)',
      'Establishes procedures for work near live conductors',
      'Defines roles: Authorised Person, Competent Person, responsible person',
      'Specifies permit-to-work requirements for HV systems',
      'Clearance distances from live conductors (EHV/HV/LV)',
      'Requirements for personal protective equipment (PPE)',
    ],
    relatedDocs: ['BS EN 50110-2 — National annexes', 'ENA TS 43-86', 'ENA Safety Rules'],
    url: 'https://www.bsigroup.com',
    tags: ['HV working', 'safety rules', 'permit to work', 'isolation', 'clearances'],
  },
  {
    id: 'GS38',
    title: 'GS38 — Electrical Test Equipment for Use on Low Voltage Electrical Systems',
    shortTitle: 'GS38',
    type: 'HSE Guidance',
    authority: 'Health and Safety Executive',
    year: 2015,
    status: 'Current (4th edition)',
    scope: 'LV electrical test equipment selection, use and maintenance',
    summary: 'HSE guidance on selecting and using safe test equipment. Covers probe design, lead construction, fusing, and safe use procedures for LV testing.',
    keyRequirements: [
      'Test leads must have adequate insulation for the voltage being tested',
      'Probes should have finger guards to prevent inadvertent contact',
      'Fused test leads required for use on live systems',
      'Test leads should be less than 1% voltage drop when loaded',
      'Equipment should be visually inspected before each use',
      'Test instruments should be CAT-rated for the installation being tested',
    ],
    relatedDocs: ['IET CoP for In-service Inspection', 'BSEN 61010 — Safety requirements for electrical equipment'],
    url: 'https://www.hse.gov.uk/pubns/gs38.htm',
    tags: ['test equipment', 'LV', 'probes', 'insulation', 'CAT rating'],
  },
  {
    id: 'BS7671',
    title: 'BS 7671:2018+A2:2022 — IET Wiring Regulations (18th Edition)',
    shortTitle: 'IET Wiring Regs',
    type: 'British Standard / Code of Practice',
    authority: 'IET / BSI',
    year: 2022,
    status: 'Current',
    scope: 'Design, construction and verification of electrical installations',
    summary: 'The national standard for electrical installation design and construction. Covers all fixed wiring installations in the UK.',
    keyRequirements: [
      'Part 1: Scope, object and fundamental principles',
      'Part 2: Definitions',
      'Part 3: Assessment of general characteristics',
      'Part 4: Protection for safety (overcurrent, RCD, surge)',
      'Part 5: Selection and erection of equipment',
      'Part 6: Inspection and testing',
      'Part 7: Special installations or locations',
    ],
    relatedDocs: ['IET On-Site Guide', 'IET Guidance Notes 1-8', 'ECA Technical Bulletins'],
    url: 'https://www.theiet.org/bs7671',
    tags: ['wiring', 'installation', 'design', 'testing', 'verification'],
  },
  {
    id: 'ENA-SR',
    title: 'ENA Safety Rules — Electrical Safety Rules for DNOs',
    shortTitle: 'ENA Safety Rules',
    type: 'Industry Standard',
    authority: 'Energy Networks Association',
    year: 2020,
    status: 'Current',
    scope: 'HV/EHV working on distribution network operator assets',
    summary: 'Industry-standard safety rules for work on distribution network assets including substations, overhead lines, and cables.',
    keyRequirements: [
      'Five Point Safety Rules for HV equipment: Isolated, Earthed, Proved Dead, Barriers/Notices, Permit-to-Work',
      'Authorised Person (AP) and Competent Person (CP) roles',
      'Safety Document procedures (Sanction for Test, Limitation Notice, Switching Programme)',
      'Caution Notice and Danger Notice requirements',
      'Minimum approach distances for live HV equipment',
      'Arc Flash risk assessment requirements',
    ],
    relatedDocs: ['Individual DNO Safety Rules (SSEN, UKPN, NGED)', 'ENA TS 43-86', 'ENA Engineering Recommendations'],
    url: 'https://www.energynetworks.org',
    tags: ['HV', 'substations', 'permit to work', 'earthing', 'isolation', 'DNO'],
  },
  {
    id: 'ENA-P2',
    title: 'ENA Engineering Recommendation P2/7 — Security of Supply',
    shortTitle: 'P2/7',
    type: 'Engineering Recommendation',
    authority: 'Energy Networks Association',
    year: 2022,
    status: 'Current',
    scope: 'Distribution network security of supply standards',
    summary: 'Defines minimum standards for security of supply from Grid Supply Points down to customer connections. Drives substation design decisions.',
    keyRequirements: [
      'Category A: Large demand groups (>100MW) — N-2 security required',
      'Category B: Medium groups (>50MW) — N-1 plus restoration within 3 hours',
      'Category C: Small groups (>1MW) — Loss of single circuit allowed temporarily',
      'Restoration times specified for each category',
      'New connections must maintain existing security standards',
    ],
    relatedDocs: ['Ofgem RIIO-ED2 licence conditions', 'DNO Distribution Code', 'ENA P28'],
    url: 'https://www.energynetworks.org',
    tags: ['security of supply', 'network design', 'GSP', 'N-1', 'N-2'],
  },
  {
    id: 'HSG85',
    title: 'HSG85 — Electricity at Work: Safe Working Practices',
    shortTitle: 'HSG85',
    type: 'HSE Guidance',
    authority: 'Health and Safety Executive',
    year: 2013,
    status: 'Current (3rd edition)',
    scope: 'Practical guidance for all who work on or with electrical systems',
    summary: 'Comprehensive practical guidance supporting the Electricity at Work Regulations. Covers isolation procedures, permits, testing, and managing electrical risk.',
    keyRequirements: [
      'Guidance on implementing EaWR Regulation 4 (systems maintenance)',
      'Safe isolation procedures step-by-step',
      'Permit-to-work system design and use',
      'Risk assessment for electrical work',
      'Live working justification and controls',
      'Competence assessment frameworks',
    ],
    relatedDocs: ['EaWR 1989', 'BS EN 50110-1', 'HSR25'],
    url: 'https://www.hse.gov.uk/pubns/priced/hsg85.pdf',
    tags: ['safe working', 'isolation', 'permit to work', 'risk assessment', 'competence'],
  },
  {
    id: 'ARCFLASH',
    title: 'Arc Flash Risk Assessment — IEC 61482 & NFPA 70E Guidance',
    shortTitle: 'Arc Flash (IEC 61482)',
    type: 'Standard / Best Practice',
    authority: 'IEC / IEEE / ENA',
    year: 2020,
    status: 'Current',
    scope: 'Arc flash hazard assessment for HV and LV electrical equipment',
    summary: 'Arc flash incidents can cause severe burns, blindness and death. Standards define how to assess arc flash energy levels and specify appropriate PPE.',
    keyRequirements: [
      'Incident energy analysis required for switchboards above 1kV',
      'PPE must be rated to the calculated incident energy (cal/cm²)',
      'Arc flash boundary must be established and communicated',
      'Minimum PPE for LV: Class 1 (4 cal/cm²) face shield and FR clothing',
      'For HV systems: full arc flash suit required during live working',
      'Working on dead equipment greatly reduces (but does not eliminate) arc flash risk',
    ],
    relatedDocs: ['BS EN 61482-1-2', 'NFPA 70E 2021', 'ENA Good Practice Guide — Arc Flash'],
    url: 'https://www.hse.gov.uk',
    tags: ['arc flash', 'PPE', 'incident energy', 'HV', 'switchboard', 'burns'],
  },
  {
    id: 'TS43-86',
    title: 'ENA Engineering Technical Specification TS 43-86 — Substation Safety',
    shortTitle: 'ENA TS 43-86',
    type: 'Technical Specification',
    authority: 'Energy Networks Association',
    year: 2019,
    status: 'Current',
    scope: 'Physical safety requirements for electricity distribution substations',
    summary: 'Defines construction, layout, access, and labelling standards for distribution substations to ensure safe working conditions.',
    keyRequirements: [
      'Minimum working space requirements around equipment',
      'Earthing system design standards',
      'Substation access control and security',
      'Warning notices and equipment labelling requirements',
      'Fire protection requirements for oil-filled equipment',
      'Lighting requirements for operational areas',
    ],
    relatedDocs: ['ENA Safety Rules', 'BS 7354 — Code of Practice for high voltage switchgear', 'ENA P29'],
    url: 'https://www.energynetworks.org',
    tags: ['substation design', 'earthing', 'access', 'labelling', 'physical safety'],
  },
  {
    id: 'RIDDOR',
    title: 'RIDDOR 2013 — Reporting of Injuries, Diseases and Dangerous Occurrences',
    shortTitle: 'RIDDOR 2013',
    type: 'Legislation',
    authority: 'UK Parliament / HSE',
    year: 2013,
    status: 'In Force',
    scope: 'Reporting requirements for workplace accidents including electrical incidents',
    summary: 'Requires employers to report certain workplace accidents to HSE. Electrical incidents involving fatality, major injury, or dangerous occurrence must be reported.',
    keyRequirements: [
      'Fatalities must be reported immediately by telephone, then formally within 10 days',
      'Specified injuries (fractures, amputations, burns >1% body surface) must be reported within 10 days',
      'Dangerous occurrences (e.g. electrical flashover that could cause injury) must be reported',
      'Over-7-day incapacitation injuries must be reported within 15 days',
      'Records must be kept for 3 years',
    ],
    relatedDocs: ['HSE RIDDOR guidance', 'EaWR 1989', 'HSG85'],
    url: 'https://www.hse.gov.uk/riddor/',
    tags: ['reporting', 'accidents', 'fatality', 'injury', 'dangerous occurrence'],
  },
];

// Compiled safety context for AI chatbot system prompt
export const getSafetyContext = () => {
  return safetyStandards.map(s =>
    `**${s.title}** (${s.authority}, ${s.year})\n${s.summary}\nKey requirements: ${s.keyRequirements.slice(0, 3).join('; ')}`
  ).join('\n\n');
};

export const CHATBOT_SYSTEM_PROMPT = `You are a UK electrical safety expert assistant for a substation management tool.

You have deep knowledge of UK electrical safety regulations and standards. When answering questions:
1. Always reference the specific UK standard or regulation
2. Prioritise worker safety above all else
3. If shown an image of electrical equipment, identify:
   - Equipment type and likely voltage level
   - Visible safety hazards or non-compliances
   - Required PPE for working near this equipment
   - Relevant safety standards that apply
4. Be clear about the limits of remote assessment — always recommend a qualified competent person for actual safety decisions

## UK Electrical Safety Standards Knowledge Base:

${getSafetyContext()}

## Key Safety Principles:
- NEVER advise anyone to work on live electrical equipment unless they are a trained, authorised person following ENA Safety Rules
- The Five Point Safety Rules (Isolated, Earthed, Proved Dead, Barriers, Permit-to-Work) must always be followed for HV work
- Arc flash risk is always present near live equipment — appropriate PPE must be worn
- When in doubt, ISOLATE the supply before approaching

Always end responses about on-site work with: "⚠️ This guidance is for information only. All electrical work must be carried out by competent, authorised persons following your organisation's Safety Rules."`;
