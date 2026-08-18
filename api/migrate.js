require('dotenv').config();
const { promisify } = require('util');
const mongoose = require('mongoose');
const { MongoStateStore, synchronizedUp } = require('@nodepit/migrate-state-store-mongodb');

setTimeout(async () => {
  // connect mongoose in the boot then other scripts can use
  await mongoose.connect(process.env.MONGO_URI);

  await synchronizedUp({
    // Set class as custom stateStore
    stateStore: new MongoStateStore({
      uri: process.env.MONGO_URI,
      /**
       * If you’re running in a clustered environments with more than one node, there will likely be concurrency issues
       * when more than one node tries to run a migration (also see here).
       * The plugin provides a locking mechanism which ensures that only one node can run migrations at a given time
       * (and other ones will just wait until the migration has finished).
       * For this, initialize MongoStateStore with a lockCollectionName:
       */
      collectionName: 'migrations',
      lockCollectionName: 'migration_lock'
    }),
    // do not filter lib folder, load only js file
    filterFunction: (fileName) => fileName.includes('.js') && !fileName.includes('lib/'),
    ignoreMissing: true
  }, async (err, loadedSet) => {
    if (err) {
      throw err;
    }

    // set.up((err2) => {
    //   if (err2) {
    //     throw err2;
    //   }
    //   // eslint-disable-next-line no-console
    //   console.log('Migrations successfully ran');
    //   process.exit();
    // });
    await promisify(loadedSet.up).call(loadedSet);
  });

  console.log('Migrations successfully ran');
  process.exit();
});
