import { Templater } from "mistts";
import * as templates from "./templates/index.js";

const templater = new Templater().add(templates.index);

console.log(
    await templater.render("templates.index", {
        username: "John Doe",
    })
);

