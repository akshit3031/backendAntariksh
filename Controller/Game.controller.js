import Level from "../Model/Level.js";
import Team from "../Model/Team.js";
import GameDetails from "../Model/GameDetails.js";
import Question from "../Model/Question.js";
import mongoose from "mongoose";


const createGameDetails = async (req, res) => {
    try{
        const gameDetails = await GameDetails.create({
            hasGameStarted: false,
            gameStartTime: null,
            gameEndTime: null,
            hasGameFinished: false,
            finishedTeams: []
        })
        return res.status(200).json({message: "Game details created successfully", gameDetails: gameDetails})
    }
    catch(error){
        return res.status(500).json({message: "Failed to create game details", error: error.message, completeError: error})
    }
}

const startGame = async (req, res) => {
    try {
        let gameDetails = await GameDetails.findOne({});
        if (!gameDetails) {
            await createGameDetails();
            gameDetails = await GameDetails.findOne({});
        }

        if (!gameDetails) {
            return res.status(500).json({ message: "Failed to initialize game details", success: false });
        }

        gameDetails.hasGameStarted = true;
        gameDetails.gameStartTime = new Date();
        await gameDetails.save();

        const allTeams = await Team.find({});
        const firstLevel = await Level.findOne({ level: 1 });

        if (!firstLevel) {
            return res.status(500).json({ message: "No level 1 found", success: false });
        }

        await Promise.all(allTeams.map(async (team) => {
            try {
                team.currentLevel = firstLevel._id;
                team.currentQuestion = await allotNewRandomQuestionFromLevel(firstLevel._id);
                team.levelStartedAt = new Date();
                await team.save();
            } catch (teamError) {
                console.error(`Failed to update team ${team._id}:`, teamError);
            }
        }));

        return res.status(200).json({ message: "Game started successfully", success: true });
    } catch (error) {
        return res.status(500).json({ message: "Failed to start the game", error: error.message, success: false });
    }
};


const fetchGameStatus = async (req, res) => {
    try{
        const gameDetails = await GameDetails.findOne({});
        return res.status(200).json({message: "Game status fetched successfully", gameDetails: gameDetails,success:true});
    }
    catch(error){
        return res.status(500).json({message: "Failed to fetch game status", error: error.message, completeError: error, success: false});
    }
}

const allotNewRandomQuestionFromLevel = async (levelId) => {
    try{
        const level = await Level.findById(levelId);
        const allQuestions = await Question.find({level: levelId});
        const allTeams = await Team.find({currentLevel: levelId});

        
        console.log("ALL QUESTIONS: ", allQuestions);
        const randomQuestion = allQuestions[Math.floor(Math.random() * allQuestions.length)];
        console.log("RANDOM QUESTION: ", randomQuestion);
        return randomQuestion;
    }
    catch(error){
        console.log(error);
        throw error;
    }
}

const updateTeamScore = async (teamId) => {
    try{
        const team = await Team.findById(teamId);
        const timeCompletedAt = new Date();
        if(team.completedQuestions.length>0){
            const lastCompletedQuestion = team.completedQuestions[team.completedQuestions.length - 1];
            const timeDelay = timeCompletedAt.getTime() - lastCompletedQuestion.completedAt.getTime(); //time delay between submitting last question and current question
            if(timeDelay < 60000){
                return {message: "You cannot submit new question so quickly. Please wait.",success:false};
            }
        }
       

        const currQuestion = team.currentQuestion;
        const levelId = team.currentLevel;
        console.log("LEVEL ID: ", levelId);
        const currLevel = await Level.findById(levelId);
        console.log("FETCHED CURRRENT LEVEL: ", currLevel);
        const levelNum = currLevel.level;
        console.log("LEVEL NUMBER: ", levelNum);


        const allLevels = await Level.find({}).sort({ level: 1 }).lean();

        const lastLevel = allLevels[allLevels.length - 1].level;
        console.log("LAST LEVEL: ", lastLevel);

        const timeTakenToCompleteTheCurrLevelInMinutes = (timeCompletedAt.getTime() - team.levelStartedAt.getTime())/ (1000 * 60);
        console.log("TIME TAKEN TO COMPLETE THE CURRENT LEVEL IN MINUTES: ", timeTakenToCompleteTheCurrLevelInMinutes);
        if(levelNum === lastLevel){
            console.log("TEAM HAS REACHED THE LAST LEVEL")
            if(!team.hasCompletedAllLevels){
                console.log("TEAM IS SUBMITTING THE QUESTION OF THE LAST LEVEL")
                const safeTimeTaken = timeTakenToCompleteTheCurrLevelInMinutes > 0 ? timeTakenToCompleteTheCurrLevelInMinutes : 1;
                team.score += 1000 + Math.max(1000 / safeTimeTaken, 0);

                
                team.currentQuestion = null;
                team.completedQuestions.push({ currentQuestion: currQuestion, level: levelId, startedAt: team.levelStartedAt, completedAt: timeCompletedAt, timeTaken: timeTakenToCompleteTheCurrLevelInMinutes })
                team.hasCompletedAllLevels = true;

                team.levelStartedAt = null;
                await team.save();
                return {message: "Team has completed all levels", success: true};
            }
            else{
                //do nothing the team has already completed and submitted the last level
                console.log("TEAM HAS ALREADY COMPLETED AND SUBMITTED THE QUESTION OF THE LAST LEVEL")
                return {message: "Team has already completed and submitted the last level",success:false};
            }
        }
        else{
            
        const nextLevelNum = levelNum + 1;
        console.log("NEXT LEVEL NUMBER: ", nextLevelNum);
        const nextLevelRef = allLevels.find((level) => level.level === nextLevelNum);
        if (!nextLevelRef) {
            console.log("Next level not found!");
            return { message: "Error: Next level not found", success: false };
        }
        
        const nextLevelId = nextLevelRef._id;

        team.currentLevel = nextLevelId;
        team.currentQuestion = await allotNewRandomQuestionFromLevel(nextLevelId);

        team.completedQuestions.push({ currentQuestion: currQuestion, level: levelId, startedAt: team.levelStartedAt, completedAt: timeCompletedAt, timeTaken: timeTakenToCompleteTheCurrLevelInMinutes })
        team.score += 1000 + (1000/timeTakenToCompleteTheCurrLevelInMinutes);
        
        //updating the new time at which the team has moved to the next level
        team.levelStartedAt = timeCompletedAt;
        // 1000 points will be given to each team for comepleting a particular level and an extra (1000/timetakentocompleteTheCurrLevelInMinutes) will be given for completing the level in less time)
        await team.save();
        console.log("TEAM HAS MOVED TO THE NEXT LEVEL");
        return {message: "Team has moved to the next level",success:true};
        }
    }
    catch(error){
        console.log(error);
        throw error;
    }
}


const resetGame = async (req, res) => {
    try {
        // Reset all teams in a single bulk update
        await Team.updateMany({}, {
            $set: {
                currentLevel: null,
                currentQuestion: null,
                score: 0,
                completedQuestions: [],
                hasCompletedAllLevels: false,
                levelStartedAt: null
            }
        });
        console.log("All teams reset to default values");

        // Reset all hints in questions in a single bulk update
        await Question.updateMany({}, { $set: { "hints.$[].flag": false } });
        console.log("All hints reset");

        // Reset game details in a single operation
        await GameDetails.updateOne({}, {
            $set: {
                hasGameStarted: false,
                gameStartTime: null,
                gameEndTime: null,
                hasGameFinished: false
            }
        });
        console.log("Game details reset");

        return res.status(200).json({ message: "Game reset successfully", success: true });
    } catch (error) {
        console.error("Error resetting game:", error);
        return res.status(500).json({ message: "Error resetting the game", error: error.message, success: false });
    }
};


const finishGame =async(req,res)=>{
    try{
        const gameDetails = await GameDetails.findOne({});
        gameDetails.hasGameFinished = true;
        gameDetails.gameEndTime = new Date();
        await gameDetails.save();
        return res.status(200).json({message: "Game finished successfully", success: true});
    }
    catch(error){
        return res.status(500).json({message: "Error finishing the game", error: error.message, completeError: error, success: false});
    }
}


export {startGame, allotNewRandomQuestionFromLevel, updateTeamScore, resetGame,fetchGameStatus,finishGame};

