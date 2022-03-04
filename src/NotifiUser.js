/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getUserSubscriptionCount(user) {
  // eslint-disable-next-line no-undef
  const q = new Moralis.Query("Subscription");
  q.equalTo("userID", user.id);
  const res = await q.count({ useMasterKey: true });
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getUserSubscriptionLimit(user) {
  const logger = Moralis.Cloud.getLogger();
  const level = await getUserLevel(user);
  logger.info("USERLEVEL=" + level);
  if (level == "Free") {
    return 3;
  } else if (level == "Basic") {
    return 10;
  } else if (level == "Gold") {
    return 100;
  }
}

async function getUserLevel(user) {
  const bal = await getUserNotifiBalance(user);
  const logger = Moralis.Cloud.getLogger();
  logger.info("USERBAL=" + bal);
  if (bal < 100) return "Free";
  else if (bal <= 500) return "Basic";
  else if (bal >= 500) return "Gold";
  return "Free";
}

async function getUserNotifiBalance(user) {
  let res = 0;
  const acct = user.get("accounts")[0];
  if (acct) {
    const q = new Moralis.Query("AvaxTokenBalance");
    q.equalTo("token_address", await NotifiTokenAddress());
    q.equalTo("address", acct);
    const rec = await q.first({ userMasterKey: true });
    if (rec) {
      const rawres = rec.get("balance");
      res = Moralis.Cloud.units({
        method: "fromWei",
        value: rawres,
      });
    }
    return res;
  }
}

async function NotifiTokenAddress() {
  const config = await Moralis.Config.get({ useMasterKey: true });
  return config.get("NotifiAddress");
}

async function validateUserRole(user, role) {
  const roleQuery = new Moralis.Query(Moralis.Role)
  roleQuery.equalTo('name', role)
  roleQuery.equalTo('users', user)
  return await roleQuery.first({ useMasterKey: true })
}

Moralis.Cloud.define('adminUser', async (request) => {
  const res = await validateUserRole(request.user, 'admin');
  return res != undefined;
})
