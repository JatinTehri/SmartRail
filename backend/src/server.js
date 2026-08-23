const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the project root .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`SmartRail backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
