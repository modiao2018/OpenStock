
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
const dns = require('dns');
// FIX for connection
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

// This is the URI we just generated
const uri = process.env.MONGODB_URI;

async function checkDBs() {
    try {
        console.log("Connecting...");
        // Connect to the cluster
        const conn = await mongoose.createConnection(uri).asPromise();
        console.log("Connected.");

        // Check 'happystock' (current target)
        const happystockDB = conn.useDb('happystock');
        const countHappyStock = await happystockDB.collection('user').countDocuments();
        console.log(`\n📂 Database 'happystock': ${countHappyStock} users`);

        // Check 'test' (default target)
        const testDB = conn.useDb('test');
        const countTest = await testDB.collection('user').countDocuments();
        console.log(`📂 Database 'test': ${countTest} users`);

        conn.close();
    } catch (e) {
        console.error(e);
    }
}

checkDBs();
