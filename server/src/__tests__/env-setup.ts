console.log('ENV SETUP: setting DB_PATH =', process.env.DB_PATH, '->', ':memory:');
process.env.DB_PATH = ':memory:';
console.log('ENV SETUP: DB_PATH is now', process.env.DB_PATH);
