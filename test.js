console.log('Backend is starting...');


try {
    const fs = require('fs');
    const path = require('path');

    const appModulePath = path.join(__dirname, 'app.module.js');
    console.log('Looking for app.module at:', appModulePath);

    if (fs.existsSync(appModulePath)) {
        console.log('app.module.js exists');
    } else {
        console.log('app.module.js does not exist');
    }

    console.log('Current directory contents:');
    const files = fs.readdirSync(__dirname);
    files.forEach(file => {
        console.log(' -', file);
    });

} catch (error) {
    console.error('Error:', error.message);
}
