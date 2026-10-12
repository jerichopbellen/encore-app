require('dotenv').config()

const app = require('./app')

const PORT = 5000

app.listen(PORT, () => {
  console.log(`Encore API is running on http://localhost:${PORT}`)
})