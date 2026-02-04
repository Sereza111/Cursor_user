/**
 * Модуль генерации реалистичных имён
 * 100+ вариантов имён и фамилий для регистрации
 */

// Массив популярных английских имён (мужские и женские)
const firstNames = [
    // Мужские имена
    'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 
    'Thomas', 'Charles', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark',
    'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian',
    'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan',
    'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry',
    'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory',
    'Frank', 'Alexander', 'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler',
    'Aaron', 'Jose', 'Adam', 'Nathan', 'Henry', 'Douglas', 'Zachary',
    // Женские имена
    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan',
    'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra',
    'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol',
    'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura',
    'Cynthia', 'Kathleen', 'Amy', 'Angela', 'Shirley', 'Anna', 'Brenda',
    'Pamela', 'Emma', 'Nicole', 'Helen', 'Samantha', 'Katherine', 'Christine',
    'Debra', 'Rachel', 'Carolyn', 'Janet', 'Catherine', 'Maria', 'Heather',
    'Diane', 'Ruth', 'Julie', 'Olivia', 'Joyce', 'Virginia', 'Victoria',
    'Kelly', 'Lauren', 'Christina', 'Joan', 'Evelyn', 'Judith', 'Megan',
    'Andrea', 'Cheryl', 'Hannah', 'Jacqueline', 'Martha', 'Gloria', 'Teresa'
];

// Массив популярных англоязычных фамилий
const lastNames = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
    'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
    'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera',
    'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans',
    'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart',
    'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz',
    'Morgan', 'Cooper', 'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos',
    'Kim', 'Cox', 'Ward', 'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood',
    'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes', 'Price', 'Alvarez',
    'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez',
    'Powell', 'Jenkins', 'Perry', 'Russell', 'Sullivan', 'Bell', 'Coleman',
    'Butler', 'Henderson', 'Barnes', 'Gonzales', 'Fisher', 'Vasquez', 'Simmons',
    'Stokes', 'Simpson', 'Webb', 'Reynolds', 'Freeman', 'Hamilton', 'Graham'
];

// Дополнительные редкие имена для разнообразия
const rareFirstNames = [
    'Aiden', 'Ethan', 'Mason', 'Logan', 'Lucas', 'Oliver', 'Elijah', 'Sebastian',
    'Caleb', 'Owen', 'Wyatt', 'Luke', 'Carter', 'Jayden', 'Dylan', 'Grayson',
    'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
    'Abigail', 'Ella', 'Avery', 'Scarlett', 'Grace', 'Chloe', 'Camila', 'Aria',
    'Riley', 'Zoey', 'Nora', 'Lily', 'Eleanor', 'Hazel', 'Violet', 'Aurora',
    'Savannah', 'Brooklyn', 'Leah', 'Zoe', 'Stella', 'Addison', 'Natalie'
];

// Дополнительные редкие фамилии
const rareLastNames = [
    'Blackwood', 'Whitfield', 'Ashford', 'Crawford', 'Thornton', 'Preston',
    'Clayton', 'Hudson', 'Spencer', 'Harrison', 'Warren', 'Chapman', 'Dawson',
    'Lambert', 'Chambers', 'Pearson', 'Freeman', 'Fitzgerald', 'Caldwell',
    'Patterson', 'Wallace', 'Morrison', 'Montgomery', 'Ferguson', 'Armstrong',
    'Cunningham', 'Stephenson', 'Davidson', 'Robertson', 'Henderson', 'Morrison'
];

/**
 * Получить случайный элемент из массива
 */
function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Генерация случайного имени
 * @param {boolean} useRare - использовать редкие имена
 */
function generateFirstName(useRare = false) {
    const names = useRare 
        ? [...firstNames, ...rareFirstNames]
        : firstNames;
    return getRandomElement(names);
}

/**
 * Генерация случайной фамилии
 * @param {boolean} useRare - использовать редкие фамилии
 */
function generateLastName(useRare = false) {
    const names = useRare
        ? [...lastNames, ...rareLastNames]
        : lastNames;
    return getRandomElement(names);
}

/**
 * Генерация полного имени
 * @param {boolean} useRare - использовать редкие имена
 * @returns {Object} - объект с firstName, lastName, fullName
 */
function generateFullName(useRare = false) {
    const firstName = generateFirstName(useRare);
    const lastName = generateLastName(useRare);
    
    return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`
    };
}

/**
 * Генерация уникального набора имён
 * @param {number} count - количество уникальных имён
 * @returns {Array} - массив объектов с именами
 */
function generateUniqueNames(count) {
    const names = new Set();
    const result = [];
    
    while (result.length < count && names.size < firstNames.length * lastNames.length) {
        const name = generateFullName(true);
        const key = `${name.firstName}-${name.lastName}`;
        
        if (!names.has(key)) {
            names.add(key);
            result.push(name);
        }
    }
    
    return result;
}

/**
 * Генерация случайного пароля
 * @param {number} length - длина пароля
 * @returns {string} - сгенерированный пароль
 */
function generatePassword(length = 12) {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    
    const allChars = uppercase + lowercase + numbers + special;
    
    // Гарантируем наличие каждого типа символов
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];
    
    // Добавляем оставшиеся символы
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Перемешиваем пароль
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Генерация случайного User-Agent
 */
function generateUserAgent() {
    const chromeVersions = ['120.0.0.0', '119.0.0.0', '118.0.0.0', '117.0.0.0', '121.0.0.0'];
    const platforms = [
        'Windows NT 10.0; Win64; x64',
        'Windows NT 11.0; Win64; x64',
        'Macintosh; Intel Mac OS X 10_15_7',
        'Macintosh; Intel Mac OS X 11_0_0',
        'X11; Linux x86_64'
    ];
    
    const chromeVersion = getRandomElement(chromeVersions);
    const platform = getRandomElement(platforms);
    
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

/**
 * Генерация случайного viewport
 */
function generateViewport() {
    const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1536, height: 864 },
        { width: 1440, height: 900 },
        { width: 1280, height: 720 },
        { width: 2560, height: 1440 }
    ];
    
    return getRandomElement(viewports);
}

// Экспорт функций
module.exports = {
    firstNames,
    lastNames,
    generateFirstName,
    generateLastName,
    generateFullName,
    generateUniqueNames,
    generatePassword,
    generateUserAgent,
    generateViewport,
    getRandomElement
};
