var express = require("express");
var router = express.Router();
const puppeteer = require("puppeteer");

//global variables to track progress/data
//TODO: bind these to a session/cookie so that more than one scraper can run at a time
const initFollowersData = Object.freeze({
  totalFollowers: 0,
  failed: false,
  finished: false,
  data: [],
});

const initFollowingData = Object.freeze({
  totalFollowing: 0,
  failed: false,
  finished: false,
  data: [],
});
const followersData = { ...initFollowersData };
const followingData = { ...initFollowingData };

//clear global var
const clearData = () => {
  followersData = initFollowersData;
  followingData = initFollowingData;
};

/* GET followers main route /followers */
router.get("/", async (req, res, next) => {
  //it a scrape is in progress return a 500
  if (followersData.data.length !== 0 && !followersData.failed) {
    //console.log(err);
    res.status(500).send("Scraping in progress.");
    return;
  }

  //if last scrape failed, clear the data and continue
  if (followersData.data.length !== 0 && followersData.failed) {
    clearData();
  }

  //destructure and assign the query parameters
  const { username, password, profile } = req.query;

  //validate the query paramters, return error if failed
  if (!username || !password || !profile) {
    res
      .status(400)
      .send(
        `Missing required field(s): ${!username ? "Username " : ""} ${
          !password ? "Password " : ""
        } ${!profile ? "Profile " : ""}`
      );
    return;
  }

  //route main try
  try {
    const browser = await puppeteer.launch({ headless: false });

    const page = await browser.newPage();

    await page.goto("https://www.instagram.com");

    //this is the main event listener, that checks for "query_hash" in the api calls
    //while scrolling and collects and appends the data to the global variable
    page.on("response", async (response) => {
      try {
        if (response.url().includes("query_hash")) {
          let responseData;
          try {
            responseData = await response.json();
          } catch (err) {
            return;
          }

          //check for FOLLOWERS data and add
          if (
            responseData &&
            responseData.data &&
            responseData.data.user &&
            responseData.data.user.edge_followed_by
          ) {
            //append new data with old data
            followersData.data = [
              ...followersData.data,
              ...responseData.data.user.edge_followed_by.edges,
            ];
            console.log(followersData.data.length);
            //tell the scraper to scroll again
            scrollFollowers();
          }

          //check for FOLLOWING data and add
          if (
            responseData &&
            responseData.data &&
            responseData.data.user &&
            responseData.data.user.edge_follow
          ) {
            //append new data with old data
            followingData.data = [
              ...followingData.data,
              ...responseData.data.user.edge_follow.edges,
            ];
            console.log(followingData.data.length);
            //tell the scraper to scroll again
            scrollFollowing();
          }
        }

        //this one checks for a failed login call, and return invalid IG message
        if (response.url().includes("ajax")) {
          const responseData = await response.json();
          if (responseData.status === "fail") {
            res.status(400).send(responseData.message);
            followersData.failed = true;
            await browser.close();
            return;
          }
          if (responseData.authenticated === false) {
            res.status(400).send("Invalid instagram login.");
            followersData.failed = true;
            await browser.close();
            return;
          }
        }
      } catch (err) {
        console.log(err);
        followersData.failed = true;
        await browser.close();
        return;
      }
    });

    //find the login elements and input the user details to log in
    let userInput = await page.waitForSelector('input[name="username"]');
    let passwordInput = await page.waitForSelector('input[name="password"]');
    let logIn = await page.waitForSelector('button[type="submit"]');
    await userInput.type(username);
    await passwordInput.type(password);
    await logIn.click();
    await page.waitForSelector('img[data-testid="user-avatar"]');
    await page.goto(`https://www.instagram.com/${profile}`);

    //find the followers button
    let followersButton = await page.waitForSelector(
      `a[href="/${profile}/followers/"]`
    );

    //find and set the followers count
    followersData.totalFollowers = await page.evaluate((profile) => {
      return parseInt(
        document
          .querySelector(`a[href="/${profile}/followers/"] > span`)
          .textContent.replace(/,/g, ""),
        10
      );
    }, profile);

    //find and set the followings count
    followingData.totalFollowing = await page.evaluate((profile) => {
      return parseInt(
        document
          .querySelector(`a[href="/${profile}/following/"] > span`)
          .textContent.replace(/,/g, ""),
        10
      );
    }, profile);

    //here is where you can set a hard limit for the scraper
     followersData.totalFollowers = 500;
     followingData.totalFollowing = 500;

    //return status OK with current progres, and begin the scraping
    //client is expected to call /followers/status to see the current status
    res.status(200).send({
      followers: {
        progress: followersData.data.length,
        totalFollowers: followersData.totalFollowers,
      },
      following: {
        progress: followingData.data.length,
        totalFollowing: followingData.totalFollowing,
      },
    });

    await followersButton.click();

    await page.waitForSelector("div[role='dialog'] > div > div:nth-child(2)");

    //asychronous scroll call
    //this tells the followers div to keep scrolling
    //and is called every time new data comes in
    const scrollFollowers = async () => {
      try {
        page.evaluate(
          () =>
            (document.querySelector(
              "div[role='dialog'] > div > div:nth-child(2)"
            ).scrollTop += 1200)
        );
        if (followersData.data.length >= followersData.totalFollowers) {
          followersData.finished = true;
          await openFollowing();
        }
      } catch (err) {
        console.log(err);
        followersData.failed = true;
      }
    };

    //asychronous scroll call
    //this tells the following div to keep scrolling
    //and is called every time new data comes in
    const scrollFollowing = async () => {
      try {
        page.evaluate(
          () =>
            (document.querySelector(
              "div[role='dialog'] > div > div:nth-child(3)"
            ).scrollTop += 1200)
        );
        if (followingData.data.length >= followingData.totalFollowing) {
          followingData.finished = true;
          browser.close();
          return;
        }
      } catch (err) {
        console.log(err);
        followersData.failed = true;
      }
    };

    const openFollowing = async () => {
      await page.evaluate(() =>
        document.querySelector('svg[aria-label="Close"]').parentElement.click()
      );
      //find the following button
      let followingButton = await page.waitForSelector(
        `a[href="/${profile}/following/"]`
      );
      await followingButton.click();
      await scrollFollowing();
    };

    //call the defined scroll call
    await scrollFollowers().catch((err) => {
      followersData.failed = true;
      console.log(err);
      browser.close();
      return;
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Scraper could not connect.");
    followersData.failed = true;
    return;
  }
});

/* GET status. */
router.get("/status", function (req, res, next) {
  //if the job has finished, return data to the client
  if (followersData.finished && followingData.finished) {
    res.status(200).send({
      followers: followersData.data,
      following: followingData.data,
      complete: true,
    });
    clearData();
  }
  //if the job failed, return error to the client
  else if (followersData.failed || followingData.failed) {
    res.status(500).send("Scraper has failed.");
    clearData();
  }
  //return current scraper job status
  else
    res.status(202).send({
      followers: {
        progress: followersData.data.length,
        totalFollowers: followersData.totalFollowers,
      },
      following: {
        progress: followingData.data.length,
        totalFollowing: followingData.totalFollowing,
      },
    });
});

module.exports = router;
