/* eslint-disable no-undef */
Moralis.Cloud.beforeSave("DiscordMessages", async (request) => {
    const q = new Moralis.Query("DiscordMessages")
    q.equalTo("discordID", request.object.get("discordID"));
    const count = await q.count();
    if (count > 0) {
        throw "Rejected duplicate Discord Message"
    }
  });

Moralis.Cloud.afterSave("DiscordMessages", async (request) => {
  const { object: dm, context } = request;
  processDiscordMessage(dm);
});

async function processDiscordMessage(dm) {
  const category = await getDiscordCategory(dm);
  if (category) {
    const Alert = Moralis.Object.extend("Alert");
    const a = new Alert();
    logger.info("a");
    a.set("protocol", category.get("protocol"));
    logger.info("b");
    a.set("content", getDiscordContent(dm));
    logger.info("c");
    a.set("richContent", getDiscordRichContent(dm));
    logger.info("d");
    a.set("Type", category);
    a.set("source", "Discord");
    a.save(null, {useMasterKey: true})
  } else {
    logger.info(`No Category found for ${dm.id}`);
  }
}

async function getDiscordCategory(dm){
  const userName = dm.get("discordUsername")
  const q = new Moralis.Query("SubscriptionType")
  logger.info(`Check for ${userName}`);
  q.equalTo("discordUsername", userName)
  const res = await q.first({useMasterKey: true})
  logger.info(`getDiscordCategory]: ${res}`);
  return res;
}

function getDiscordContent(dm) {
  return dm.get("content");
}

function getDiscordRichContent(dm) {
  const base = dm.get("content");
  return `<h1>Update</h1> ${base}`;
}