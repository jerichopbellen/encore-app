const pool = require('../config/db')

async function testConnection() {
  try {
    const result = await pool.query(
      'SELECT current_database(), current_user, NOW()'
    )

    console.log('Database connection successful!')
    console.log(result.rows[0])
  } catch (error) {
    console.error('Database connection failed:', error.message)
  } finally {
    await pool.end()
  }
}

testConnection()
