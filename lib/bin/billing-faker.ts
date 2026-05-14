import { randomInt } from 'node:crypto'
import type { BillingTemplate } from './to-vcc'

/**
 * Per-country billing data presets used to auto-fake `BillingTemplate`s
 * when the user does not supply one. Each entry contains:
 *
 *   - firstNames + lastNames: realistic, locale-appropriate names. Mixed
 *     gender. Pool size ≥ 10 each so combinations stay non-repetitive
 *     across batches.
 *   - addresses: real-world commercial / well-known street addresses with
 *     a city, state, and postal code that match Stripe's <option value>
 *     vocabulary for that country (e.g. ID uses full province names,
 *     US uses 2-letter state codes, GB uses county / region names).
 *
 * Addresses are intentionally landmark / corporate (Apple Park, Petronas
 * Towers, Marina Bay) — they pass postal-code validation and Stripe's
 * AVS sanity checks without leaking residential addresses of real people.
 *
 * State/province strings are Stripe-aware: leaving `state` unset is
 * meaningful for countries Stripe doesn't ask for one (SG, NL when
 * billing region not required). Empty-string is normalized to "no state"
 * by the generator.
 */

type Address = {
  line1: string
  city: string
  state?: string
  postalCode: string
}

type Preset = {
  firstNames: string[]
  lastNames: string[]
  addresses: Address[]
}

const PRESETS: Record<string, Preset> = {
  US: {
    firstNames: [
      'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer',
      'Michael', 'Linda', 'David', 'Sarah', 'William', 'Jessica',
      'Richard', 'Karen', 'Joseph', 'Nancy', 'Thomas', 'Lisa',
      'Christopher', 'Margaret'
    ],
    lastNames: [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
      'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
      'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore',
      'Jackson', 'Martin'
    ],
    addresses: [
      { line1: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', postalCode: '94043' },
      { line1: '350 Fifth Avenue', city: 'New York', state: 'NY', postalCode: '10118' },
      { line1: '233 South Wacker Drive', city: 'Chicago', state: 'IL', postalCode: '60606' },
      { line1: '1 Microsoft Way', city: 'Redmond', state: 'WA', postalCode: '98052' },
      { line1: '500 South Buena Vista Street', city: 'Burbank', state: 'CA', postalCode: '91521' },
      { line1: '1 Apple Park Way', city: 'Cupertino', state: 'CA', postalCode: '95014' },
      { line1: '410 Terry Avenue North', city: 'Seattle', state: 'WA', postalCode: '98109' },
      { line1: '1101 K Street NW', city: 'Washington', state: 'DC', postalCode: '20005' },
      { line1: '1 Hacker Way', city: 'Menlo Park', state: 'CA', postalCode: '94025' },
      { line1: '300 Boylston Street', city: 'Boston', state: 'MA', postalCode: '02116' }
    ]
  },
  ID: {
    firstNames: [
      'Budi', 'Siti', 'Andi', 'Dewi', 'Eko', 'Rina', 'Hadi', 'Maya',
      'Yusuf', 'Lestari', 'Agus', 'Putri', 'Surya', 'Anita', 'Bayu',
      'Sri', 'Joko', 'Wati', 'Rizki', 'Indah'
    ],
    lastNames: [
      'Santoso', 'Wijaya', 'Saputra', 'Sari', 'Pratama', 'Lestari',
      'Hidayat', 'Nugroho', 'Susanto', 'Kurniawan', 'Hartono',
      'Setiawan', 'Rahayu', 'Suryadi', 'Permana', 'Wibowo', 'Iskandar'
    ],
    addresses: [
      { line1: 'Jalan Jenderal Sudirman No. 52-53', city: 'Jakarta Selatan', state: 'DKI Jakarta', postalCode: '12190' },
      { line1: 'Jalan MH Thamrin No. 28-30', city: 'Jakarta Pusat', state: 'DKI Jakarta', postalCode: '10350' },
      { line1: 'Jalan Asia Afrika No. 8', city: 'Bandung', state: 'Jawa Barat', postalCode: '40111' },
      { line1: 'Jalan Pemuda No. 175', city: 'Surabaya', state: 'Jawa Timur', postalCode: '60271' },
      { line1: 'Jalan Diponegoro No. 110', city: 'Semarang', state: 'Jawa Tengah', postalCode: '50132' },
      { line1: 'Jalan Imam Bonjol No. 7', city: 'Medan', state: 'Sumatera Utara', postalCode: '20152' },
      { line1: 'Jalan Sunset Road No. 88', city: 'Kuta', state: 'Bali', postalCode: '80361' },
      { line1: 'Jalan Pahlawan No. 25', city: 'Yogyakarta', state: 'Daerah Istimewa Yogyakarta', postalCode: '55121' }
    ]
  },
  GB: {
    firstNames: [
      'Oliver', 'Olivia', 'George', 'Amelia', 'Harry', 'Isla',
      'Jack', 'Ava', 'Charlie', 'Mia', 'Thomas', 'Emily', 'Oscar',
      'Sophia', 'William', 'Grace', 'James', 'Lily', 'Henry', 'Ella'
    ],
    lastNames: [
      'Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies',
      'Wilson', 'Evans', 'Thomas', 'Roberts', 'Johnson', 'Walker',
      'Wright', 'Robinson', 'Thompson', 'White', 'Hughes', 'Edwards'
    ],
    addresses: [
      { line1: '10 Downing Street', city: 'London', state: 'Greater London', postalCode: 'SW1A 2AA' },
      { line1: '1 Canada Square', city: 'London', state: 'Greater London', postalCode: 'E14 5AB' },
      { line1: '20 Fenchurch Street', city: 'London', state: 'Greater London', postalCode: 'EC3M 3BY' },
      { line1: 'Trafford Park, Mosley Road', city: 'Manchester', state: 'Greater Manchester', postalCode: 'M17 1AB' },
      { line1: '5 Princes Street', city: 'Edinburgh', state: 'Midlothian', postalCode: 'EH2 2DG' },
      { line1: '40 Bothwell Street', city: 'Glasgow', state: 'Lanarkshire', postalCode: 'G2 6LU' },
      { line1: 'Brindleyplace 1', city: 'Birmingham', state: 'West Midlands', postalCode: 'B1 2HQ' }
    ]
  },
  SG: {
    firstNames: [
      'Wei Ming', 'Mei Ling', 'Jun Hao', 'Xin Yi', 'Hao Ran',
      'Jia Hui', 'Zhi Xuan', 'Yu Xuan', 'Li Wei', 'Hui Min',
      'Daryl', 'Rachel', 'Marcus', 'Charmaine', 'Bryan', 'Joanne'
    ],
    lastNames: [
      'Tan', 'Lim', 'Ng', 'Lee', 'Goh', 'Wong', 'Chua', 'Ong',
      'Tay', 'Koh', 'Sim', 'Toh', 'Yeo', 'Heng', 'Chong', 'Teo'
    ],
    addresses: [
      { line1: '1 Marina Boulevard, #28-00', city: 'Singapore', postalCode: '018989' },
      { line1: '10 Bayfront Avenue', city: 'Singapore', postalCode: '018956' },
      { line1: '2 Orchard Turn, #B2-50', city: 'Singapore', postalCode: '238801' },
      { line1: '6 Battery Road, #38-01', city: 'Singapore', postalCode: '049909' },
      { line1: '1 Wallich Street, #14-01', city: 'Singapore', postalCode: '078881' },
      { line1: '8 Marina View, Asia Square Tower 1', city: 'Singapore', postalCode: '018960' }
    ]
  },
  MY: {
    firstNames: [
      'Ahmad', 'Siti', 'Muhammad', 'Nur', 'Ali', 'Aisyah',
      'Hassan', 'Fatimah', 'Ibrahim', 'Aminah', 'Hafiz', 'Aida',
      'Faisal', 'Liyana', 'Adam', 'Sofia'
    ],
    lastNames: [
      'bin Abdullah', 'binti Ismail', 'bin Hassan', 'binti Ahmad',
      'bin Mohamed', 'binti Yusof', 'bin Ali', 'binti Hashim',
      'bin Rahman', 'binti Salleh'
    ],
    addresses: [
      { line1: 'KLCC, Jalan Ampang', city: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', postalCode: '50088' },
      { line1: 'Jalan Sultan Ismail', city: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', postalCode: '50250' },
      { line1: 'Jalan Tun Razak', city: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', postalCode: '50400' },
      { line1: 'Persiaran Gurney 70', city: 'George Town', state: 'Pulau Pinang', postalCode: '10250' },
      { line1: 'Jalan Lagoon Selatan', city: 'Petaling Jaya', state: 'Selangor', postalCode: '46150' }
    ]
  },
  AU: {
    firstNames: [
      'Oliver', 'Charlotte', 'Jack', 'Olivia', 'Noah', 'Amelia',
      'William', 'Ava', 'Thomas', 'Mia', 'Lucas', 'Isla',
      'Henry', 'Grace', 'Ethan', 'Chloe'
    ],
    lastNames: [
      'Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor',
      'Anderson', 'Thompson', 'White', 'Harris', 'Martin', 'Thomas'
    ],
    addresses: [
      { line1: '1 Macquarie Place', city: 'Sydney', state: 'NSW', postalCode: '2000' },
      { line1: '101 Collins Street', city: 'Melbourne', state: 'VIC', postalCode: '3000' },
      { line1: '111 Eagle Street', city: 'Brisbane', state: 'QLD', postalCode: '4000' },
      { line1: '108 St Georges Terrace', city: 'Perth', state: 'WA', postalCode: '6000' },
      { line1: '12 Moore Street', city: 'Canberra', state: 'ACT', postalCode: '2601' }
    ]
  },
  CA: {
    firstNames: [
      'Liam', 'Emma', 'Noah', 'Olivia', 'William', 'Charlotte',
      'Benjamin', 'Sophia', 'Lucas', 'Amelia', 'Owen', 'Emily',
      'Ethan', 'Hannah', 'Logan', 'Madison'
    ],
    lastNames: [
      'Tremblay', 'Roy', 'Gagnon', 'Bouchard', 'Smith', 'Brown',
      'Wilson', 'Taylor', 'Anderson', 'Martin', 'Thompson', 'Lee'
    ],
    addresses: [
      { line1: '100 Queen Street West', city: 'Toronto', state: 'ON', postalCode: 'M5H 2N2' },
      { line1: '999 Canada Place', city: 'Vancouver', state: 'BC', postalCode: 'V6C 3E2' },
      { line1: '275 Slater Street', city: 'Ottawa', state: 'ON', postalCode: 'K1P 5H9' },
      { line1: '1100 René-Lévesque Boulevard West', city: 'Montréal', state: 'QC', postalCode: 'H3B 4N4' },
      { line1: '101 6 Avenue SW', city: 'Calgary', state: 'AB', postalCode: 'T2P 3P4' }
    ]
  },
  DE: {
    firstNames: [
      'Maximilian', 'Sophie', 'Alexander', 'Marie', 'Paul', 'Emma',
      'Leon', 'Mia', 'Felix', 'Hanna', 'Jonas', 'Lea',
      'Niklas', 'Lena', 'Tim', 'Sarah'
    ],
    lastNames: [
      'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer',
      'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch'
    ],
    addresses: [
      { line1: 'Unter den Linden 1', city: 'Berlin', state: 'Berlin', postalCode: '10117' },
      { line1: 'Marienplatz 8', city: 'München', state: 'Bayern', postalCode: '80331' },
      { line1: 'Domplatz 1', city: 'Hamburg', state: 'Hamburg', postalCode: '20095' },
      { line1: 'Königsallee 27', city: 'Düsseldorf', state: 'Nordrhein-Westfalen', postalCode: '40212' },
      { line1: 'Frankfurter Allee 35', city: 'Frankfurt am Main', state: 'Hessen', postalCode: '60314' }
    ]
  },
  FR: {
    firstNames: [
      'Lucas', 'Léa', 'Hugo', 'Manon', 'Louis', 'Camille',
      'Arthur', 'Sarah', 'Jules', 'Emma', 'Nathan', 'Chloé',
      'Adam', 'Inès', 'Raphaël', 'Lina'
    ],
    lastNames: [
      'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard',
      'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent'
    ],
    addresses: [
      { line1: '1 Place de la Concorde', city: 'Paris', state: 'Île-de-France', postalCode: '75008' },
      { line1: '5 Rue de Rivoli', city: 'Paris', state: 'Île-de-France', postalCode: '75001' },
      { line1: '32 Boulevard de la Croisette', city: 'Cannes', state: "Provence-Alpes-Côte d'Azur", postalCode: '06400' },
      { line1: '3 Cours Charlemagne', city: 'Lyon', state: 'Auvergne-Rhône-Alpes', postalCode: '69002' },
      { line1: '1 Place du Capitole', city: 'Toulouse', state: 'Occitanie', postalCode: '31000' }
    ]
  },
  JP: {
    firstNames: [
      'Hiroshi', 'Yuki', 'Kenji', 'Aiko', 'Takeshi', 'Sakura',
      'Ren', 'Hanako', 'Daiki', 'Mei', 'Sora', 'Yui',
      'Haruto', 'Riko', 'Itsuki', 'Akari'
    ],
    lastNames: [
      'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito',
      'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada'
    ],
    addresses: [
      { line1: '1-1-2 Oshiage', city: 'Sumida', state: 'Tokyo', postalCode: '131-0045' },
      { line1: '5-9-1 Ginza', city: 'Chuo', state: 'Tokyo', postalCode: '104-0061' },
      { line1: '1-1-1 Marunouchi', city: 'Chiyoda', state: 'Tokyo', postalCode: '100-0005' },
      { line1: '3-1-1 Umeda', city: 'Kita', state: 'Osaka', postalCode: '530-0001' },
      { line1: '1-1-1 Sannomiya-cho', city: 'Chuo', state: 'Hyogo', postalCode: '650-0021' }
    ]
  },
  IN: {
    firstNames: [
      'Aarav', 'Aanya', 'Arjun', 'Ananya', 'Vihaan', 'Ishaan',
      'Aditi', 'Priya', 'Rohan', 'Riya', 'Aryan', 'Diya',
      'Krishna', 'Saanvi', 'Vivaan', 'Pari'
    ],
    lastNames: [
      'Sharma', 'Patel', 'Kumar', 'Singh', 'Gupta', 'Shah',
      'Mehta', 'Verma', 'Reddy', 'Nair', 'Iyer', 'Joshi'
    ],
    addresses: [
      { line1: 'Bandra Kurla Complex, BKC', city: 'Mumbai', state: 'Maharashtra', postalCode: '400051' },
      { line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
      { line1: 'Connaught Place', city: 'New Delhi', state: 'Delhi', postalCode: '110001' },
      { line1: '5 Cyber City, Phase III', city: 'Gurugram', state: 'Haryana', postalCode: '122002' },
      { line1: 'Hitech City, Madhapur', city: 'Hyderabad', state: 'Telangana', postalCode: '500081' }
    ]
  },
  PH: {
    firstNames: [
      'Juan', 'Maria', 'Jose', 'Anna', 'Carlos', 'Sofia',
      'Miguel', 'Isabella', 'Antonio', 'Camille', 'Luis', 'Andrea',
      'Diego', 'Patricia', 'Marco', 'Bea'
    ],
    lastNames: [
      'Dela Cruz', 'Garcia', 'Reyes', 'Cruz', 'Bautista', 'Santos',
      'Gonzales', 'Mendoza', 'Aquino', 'Torres', 'Ramos', 'Castillo'
    ],
    addresses: [
      { line1: '5th Avenue corner 30th Street, BGC', city: 'Taguig', state: 'Metro Manila', postalCode: '1634' },
      { line1: 'Ayala Avenue', city: 'Makati', state: 'Metro Manila', postalCode: '1226' },
      { line1: 'Mactan Newtown', city: 'Lapu-Lapu', state: 'Cebu', postalCode: '6015' },
      { line1: 'Filinvest Corporate City', city: 'Muntinlupa', state: 'Metro Manila', postalCode: '1781' }
    ]
  },
  TH: {
    firstNames: [
      'Somchai', 'Suda', 'Anan', 'Wipa', 'Niran', 'Kanya',
      'Chai', 'Malee', 'Boon', 'Pim', 'Chaiya', 'Nok',
      'Tawan', 'Lalita', 'Krit', 'Nichapha'
    ],
    lastNames: [
      'Saetang', 'Saelim', 'Boonmee', 'Suwannarat', 'Phromma',
      'Wongthong', 'Sukhum', 'Chaiwong', 'Phukhet', 'Srisawat'
    ],
    addresses: [
      { line1: '999/9 Rama I Road', city: 'Bangkok', state: 'Bangkok', postalCode: '10330' },
      { line1: '120/1 Sukhumvit Road', city: 'Bangkok', state: 'Bangkok', postalCode: '10110' },
      { line1: '101 True Tower', city: 'Bangkok', state: 'Bangkok', postalCode: '10310' },
      { line1: '191 Silom Road', city: 'Bangkok', state: 'Bangkok', postalCode: '10500' }
    ]
  },
  BR: {
    firstNames: [
      'Miguel', 'Helena', 'Davi', 'Alice', 'Arthur', 'Laura',
      'Bernardo', 'Manuela', 'Heitor', 'Sophia', 'Theo', 'Isabella',
      'Lorenzo', 'Júlia', 'Gabriel', 'Maria'
    ],
    lastNames: [
      'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira',
      'Costa', 'Ferreira', 'Rodrigues', 'Almeida', 'Ribeiro', 'Carvalho'
    ],
    addresses: [
      { line1: 'Avenida Paulista 1578', city: 'São Paulo', state: 'SP', postalCode: '01310-200' },
      { line1: 'Avenida Atlântica 1702', city: 'Rio de Janeiro', state: 'RJ', postalCode: '22021-001' },
      { line1: 'Setor Bancário Sul, Quadra 1', city: 'Brasília', state: 'DF', postalCode: '70073-901' },
      { line1: 'Avenida Afonso Pena 1500', city: 'Belo Horizonte', state: 'MG', postalCode: '30130-005' }
    ]
  },
  NL: {
    firstNames: [
      'Daan', 'Emma', 'Sem', 'Tess', 'Lucas', 'Sophie',
      'Liam', 'Anna', 'Noah', 'Saar', 'Finn', 'Mila',
      'Levi', 'Lotte', 'Bram', 'Eva'
    ],
    lastNames: [
      'de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk',
      'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder'
    ],
    addresses: [
      { line1: 'Damrak 1', city: 'Amsterdam', state: 'Noord-Holland', postalCode: '1012 LG' },
      { line1: 'Coolsingel 40', city: 'Rotterdam', state: 'Zuid-Holland', postalCode: '3011 AD' },
      { line1: 'Hofweg 9', city: "'s-Gravenhage", state: 'Zuid-Holland', postalCode: '2511 AA' },
      { line1: 'Vredenburg 40', city: 'Utrecht', state: 'Utrecht', postalCode: '3511 BD' }
    ]
  }
}

const FALLBACK_COUNTRY = 'US'

/**
 * Build a `BillingTemplate` for the requested country, populated with
 * realistic randomized name + address. Re-rolling produces different
 * values — callers that want one billing per generated card should call
 * this once per card.
 *
 * If `alpha2` does not match a shipped preset (or is undefined), the
 * fallback is the US preset and `country` is set to "US". This keeps the
 * Stripe billing form valid even when the BIN sources couldn't tell us
 * the issuer country.
 */
export function fakeBilling(alpha2?: string): BillingTemplate {
  const code = (alpha2 ?? FALLBACK_COUNTRY).toUpperCase()
  const preset = PRESETS[code] ?? PRESETS[FALLBACK_COUNTRY]
  const billingCountry = PRESETS[code] ? code : FALLBACK_COUNTRY

  const fn = preset.firstNames[randomInt(0, preset.firstNames.length)]
  const ln = preset.lastNames[randomInt(0, preset.lastNames.length)]
  const addr = preset.addresses[randomInt(0, preset.addresses.length)]

  const billing: BillingTemplate = {
    name: `${fn} ${ln}`,
    country: billingCountry,
    line1: addr.line1,
    city: addr.city,
    postalCode: addr.postalCode
  }
  if (addr.state && addr.state.trim()) billing.state = addr.state
  return billing
}

/** ISO alpha-2 codes that have first-class billing presets. */
export function supportedBillingCountries(): string[] {
  return Object.keys(PRESETS).sort()
}

/** Whether a country has a first-class preset (case-insensitive). */
export function hasBillingPreset(alpha2: string | undefined): boolean {
  if (!alpha2) return false
  return alpha2.toUpperCase() in PRESETS
}
