/* eslint-disable no-undef */
Moralis.Cloud.beforeSave("DiscordMessages", async (request) => {
    const { object: dm, context } = request;
    const q = new Moralis.Query("DiscordMessages")
    const dupCheck = context && !context.addAlert;
    if (dupCheck) {
      q.equalTo("discordID", dm.get("discordID"));
      const count = await q.count();
      if (count > 0) {
          throw "Rejected duplicate Discord Message"
      }
    }
  });

Moralis.Cloud.afterSave("DiscordMessages", async (request) => {
  const { object: dm, context } = request;
  const notAlert = context && !context.addAlert;
  if (notAlert) {
    processDiscordMessage(dm);
  }
});

Moralis.Cloud.define("processDiscordMessage", async (request) => {
  const query = new Moralis.Query("DiscordMessages");
  const dm = await query.get(request.params.id, {useMasterKey: true});
  if (dm) {
    await processDiscordMessage(dm);
  } else {
    throw "Failed to locate that ID";
  }
  return true;
})

Moralis.Cloud.job("processDiscordMessage", async (request) => {
  const { params, headers, log, message } = request;
  const query = new Moralis.Query("DiscordMessages");
  const dm = await query.get(params.id, {useMasterKey: true});
  if (dm) {
    message("Processing")
    await processDiscordMessage(dm);
    message("Completed");
  } else {
    throw "Failed to locate that ID";
  }
  return true;
})

async function processDiscordMessage(dm) {
  const category = await getDiscordCategory(dm);
  if (category) {
    const Alert = Moralis.Object.extend("Alert");
    const a = new Alert();
    a.set("protocol", category.get("protocol"));
    a.set("content", getDiscordContent(dm));
    a.set("richContent", getDiscordRichContent(dm));
    a.set("Type", category);
    a.set("source", "Discord");
    a.set("url", dm.get("discordUrl"));
    const newA = await a.save(null, {useMasterKey: true})
    dm.set("Alert", newA);
    await dm.save(null, { context: {addAlert: true}, useMasterKey: true})
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
  const html = markdown(base);
  return `${html}`;
}