import { banner } from './utils/banner.js';
import { logger } from './utils/logger.js';
import fs from 'fs';

const getTokens = () => {
  return fs.readFileSync('token.txt', 'utf8').trim().split('\n');
};

const saveTokens = (tokens) => {
  fs.writeFileSync('token.txt', tokens.join('\n'), 'utf8');
};

const colay = async (url, method, payloadData = null, additionalHeaders = {}, retry = false) => {
  try {
    const headers = {
      "Content-Type": "application/json",
      ...additionalHeaders,
    };

    const options = { method, headers };

    if (payloadData) {
      options.body = JSON.stringify(payloadData);
    }

    const response = await fetch(url, options);

    if (response.status === 401 && !retry) {
      logger('Unauthorized request. Triggering token revalidation...', 'warn');
      throw new Error('UNAUTHORIZED');
    } else if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    logger('Error during request:', 'error', error);
    throw error;
  }
};

const revalidateToken = async (token, index, tokens) => {
  const url = "https://quest.redactedairways.com/ecom-gateway/revalidate";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'POST', null, headers);
    if (data && data.token) {
      logger(`Account ${index + 1} revalidated successfully`, 'info');
      tokens[index] = data.token;
      saveTokens(tokens);
      return data.token;
    }
  } catch (error) {
    logger(`Error revalidating Account ${index + 1} :`, 'error', error);
  }
  return null;
};

const profile = async (token) => {
  const url = "https://quest.redactedairways.com/ecom-gateway/user/info";
  const headers = { "Authorization": `Bearer ${token}` };
  return await colay(url, 'GET', null, headers);
};

const fetchTaskList = async (token) => {
  const url = "https://quest.redactedairways.com/ecom-gateway/task/list";
  const headers = { "Authorization": `Bearer ${token}` };
  const data = await colay(url, 'GET', null, headers);

  return data.list
    .filter(task => !task.completed)
    .map(({ _id, task_action, tweet_id, twitter_id }) => ({
      _id,
      task_action,
      tweet_id: tweet_id || null,
      twitter_id: twitter_id || null,
    }));
};

const fetchTaskListPartner = async (token) => {
  const url = "https://quest.redactedairways.com/ecom-gateway/partners";
  const headers = { "Authorization": `Bearer ${token}` };
  const data = await colay(url, 'GET', null, headers);

  const incompleteTasks = [];
  data.data.forEach(partner => {
    partner.tasks
      .filter(task => task.status === "incomplete")
      .forEach(task => {
        incompleteTasks.push({
          partner_id: partner._id,
          task_type: task.task_type,
        });
      });
  });
  return incompleteTasks;
};

const doTask = async (action, taskId, resourceId, token) => {
  const urlMap = {
    follow: "https://quest.redactedairways.com/ecom-gateway/task/follow",
    retweet: "https://quest.redactedairways.com/ecom-gateway/task/retweet",
    like: "https://quest.redactedairways.com/ecom-gateway/task/like",
  };

  const payload = {
    taskId,
    twitterId: action === "follow" ? resourceId : undefined,
    tweetId: action !== "follow" ? resourceId : undefined,
  };

  const headers = { "Authorization": `Bearer ${token}` };

  logger(`Processing task: TaskID: ${taskId} | TaskType: ${action}`, 'info');
  return await colay(urlMap[action], 'POST', payload, headers);
};

const doTaskPartner = async (partnerId, taskType, token) => {
  const url = "https://quest.redactedairways.com/ecom-gateway/partnerActivity";
  const payload = { partnerId, taskType };
  const headers = { "Authorization": `Bearer ${token}` };

  logger(`Processing partner task: PartnerID: ${partnerId} | TaskType: ${taskType}`, 'info');
  return await colay(url, 'POST', payload, headers);
};

const processToken = async (token, index) => {
  try {
    // Fetch profile
    const info = await profile(token);
    logger(`User: ${info.userData.username} - ID: ${info.userData._id} - Score: ${info.userData.overall_score}`);

    // Fetch tasks
    const taskList = await fetchTaskList(token);
    logger(`Account ${index + 1} - Found tasks: ${taskList.length}`, 'info');

    for (const task of taskList) {
      if (task.task_action === "telegram-auth") {
        logger('its telegram auth task. Skipping...', 'warn');
        continue;
      }
      await doTask(task.task_action, task._id, task.twitter_id || task.tweet_id, token);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const partnerTaskList = await fetchTaskListPartner(token);
    logger(`Account ${index + 1} - Partner tasks found: ${partnerTaskList.length}`, 'info');

    for (const task of partnerTaskList) {
      await doTaskPartner(task.partner_id, task.task_type, token);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return true;
  } catch (error) {
    logger(`Error processing tasks for Account ${index + 1}:`, 'error', error);
    return false;
  }
};

const main = async () => {
  logger(banner, 'debug');

  while (true) {
    const tokens = getTokens();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const success = await processToken(token, i);

      if (!success) {
        const newToken = await revalidateToken(token, i, tokens);
        i--;
        if (!newToken) {
          logger(`Failed to revalidate Account ${i + 1}.`, 'error');
        }
      }
    }

    logger("Cooldown 1 hour before the next Check...");
    await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
  }
};

main();
