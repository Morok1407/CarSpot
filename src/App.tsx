import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
    const [appName, setAppName] = useState("");

    useEffect(() => {
        invoke<string>("get_app_name")
            .then(setAppName)
            .catch(console.error);
    }, []);

    return (
        <main>
            <h1>{appName}</h1>
        </main>
    );
}

export default App;