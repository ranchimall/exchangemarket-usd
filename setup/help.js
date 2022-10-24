let message = `
Exchange market
---------------

npm install                     - Install the app and node modules.
npm run help                    - List all commands.
npm run setup                   - Finish the setup (configure and reset password).
npm run configure               - Configure the app.
npm run reset-password          - Reset the password (for private-key).
npm run create-schema           - Create schema in MySQL database.
npm run configure-backup        - Configure the backup.
npm run create-backup-schema    - Create backup-schema in MySQL database.
npm run backup                  - Run the backup-node.

npm start                       - Start the application (main).

NOTE: argument 'PASSWORD' required for 'npm start'
npm start -- -PASSWORD=<password>

`;

console.log(message);